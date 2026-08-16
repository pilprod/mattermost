// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Package oauthopenid implements generic OpenID Connect (OAuth 2.0) support
// for Mattermost Team/Free Edition by registering a provider under the
// model.ServiceOpenid key. This enables MM_OPENIDSETTINGS_* environment
// variables to work without an Enterprise license.
package oauthopenid

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	jwtv5 "github.com/golang-jwt/jwt/v5"
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/einterfaces"
)

const (
	jwksCacheTTL        = 10 * time.Minute
	maxOIDCResponseSize = 1 << 20
)

// jwkSet is the JSON structure returned by a JWKS endpoint.
type jwkSet struct {
	Keys []jwk `json:"keys"`
}

// jwk represents a single JSON Web Key.
type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	// RSA
	N string `json:"n"`
	E string `json:"e"`
	// EC
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

type jwksCacheEntry struct {
	keys      map[string]crypto.PublicKey
	fetchedAt time.Time
}

// OpenIDProvider implements einterfaces.OAuthProvider for generic OIDC.
// It caches JWKS by URI so multiple providers cannot overwrite each other's
// verification context.
type OpenIDProvider struct {
	mu         sync.RWMutex
	jwksCache  map[string]*jwksCacheEntry
	httpClient *http.Client
}

// OpenIDUser maps standard OIDC userinfo claims.
type OpenIDUser struct {
	Sub               string `json:"sub"`
	Email             string `json:"email"`
	Name              string `json:"name"`
	GivenName         string `json:"given_name"`
	FamilyName        string `json:"family_name"`
	PreferredUsername string `json:"preferred_username"`
	EmailVerified     *bool  `json:"email_verified"`
}

// openIDClaims is used only for JWT parsing; embedding RegisteredClaims lets
// golang-jwt/v5 enforce exp/nbf/iat automatically.
type openIDClaims struct {
	Email             string `json:"email"`
	Name              string `json:"name"`
	GivenName         string `json:"given_name"`
	FamilyName        string `json:"family_name"`
	PreferredUsername string `json:"preferred_username"`
	EmailVerified     *bool  `json:"email_verified"`
	Nonce             string `json:"nonce"`
	AuthorizedParty   string `json:"azp"`
	jwtv5.RegisteredClaims
}

func init() {
	einterfaces.RegisterOAuthProvider(model.ServiceOpenid, &OpenIDProvider{})
}

func (u *OpenIDUser) IsValid() error {
	if u.Sub == "" {
		return errors.New("openid: user sub claim cannot be empty")
	}
	if u.Email == "" {
		return errors.New("openid: user email claim cannot be empty")
	}
	if u.EmailVerified == nil || !*u.EmailVerified {
		return errors.New("openid: user email is not verified")
	}
	return nil
}

func (u *OpenIDUser) hasAuthData() error {
	if u.Sub == "" {
		return errors.New("openid: user sub claim cannot be empty")
	}
	return nil
}

func (u *OpenIDUser) mergeFallback(fallback *OpenIDUser) {
	if fallback == nil {
		return
	}
	if u.Sub == "" {
		u.Sub = fallback.Sub
	}
	if u.Email == "" {
		u.Email = fallback.Email
	}
	if u.Name == "" {
		u.Name = fallback.Name
	}
	if u.GivenName == "" {
		u.GivenName = fallback.GivenName
	}
	if u.FamilyName == "" {
		u.FamilyName = fallback.FamilyName
	}
	if u.PreferredUsername == "" {
		u.PreferredUsername = fallback.PreferredUsername
	}
	if u.EmailVerified == nil {
		u.EmailVerified = fallback.EmailVerified
	}
}

func openIDUserFromModelUser(user *model.User) *OpenIDUser {
	if user == nil {
		return nil
	}
	ou := &OpenIDUser{
		Email:             user.Email,
		GivenName:         user.FirstName,
		FamilyName:        user.LastName,
		PreferredUsername: user.Username,
	}
	if user.EmailVerified {
		ou.EmailVerified = model.NewPointer(true)
	}
	if user.AuthData != nil {
		ou.Sub = *user.AuthData
	}
	return ou
}

func userFromOpenIDUser(logger mlog.LoggerIFace, ou *OpenIDUser, settings *model.SSOSettings) *model.User {
	user := &model.User{}

	// Derive username: prefer preferred_username, fall back to email local-part.
	raw := ou.PreferredUsername
	if raw == "" {
		raw = strings.Split(ou.Email, "@")[0]
	} else {
		// Drop domain suffix when preferred_username looks like an email.
		raw = strings.Split(raw, "@")[0]
	}
	// UsePreferredUsername=true keeps the claim as-is; default behaviour
	// (false) still uses preferred_username but sanitises it.
	_ = settings // UsePreferredUsername has no meaningful effect here since
	// Keycloak already exposes the short username via preferred_username.
	user.Username = model.CleanUsername(logger, raw)

	// Names.
	if ou.GivenName != "" || ou.FamilyName != "" {
		user.FirstName = ou.GivenName
		user.LastName = ou.FamilyName
	} else if ou.Name != "" {
		parts := strings.SplitN(ou.Name, " ", 2)
		user.FirstName = parts[0]
		if len(parts) == 2 {
			user.LastName = parts[1]
		}
	}

	user.Email = strings.ToLower(ou.Email)
	user.EmailVerified = true
	// sub is a stable, unique identifier across the OIDC provider.
	user.AuthData = &ou.Sub
	user.AuthService = model.ServiceOpenid

	return user
}

func validateAllowedEmailDomain(email string, settings *model.SSOSettings) error {
	if settings == nil || settings.AllowedDomains == nil || strings.TrimSpace(*settings.AllowedDomains) == "" {
		return nil
	}
	at := strings.LastIndex(email, "@")
	if at <= 0 || at == len(email)-1 {
		return errors.New("openid: email does not contain a valid domain")
	}
	emailDomain := strings.ToLower(email[at+1:])
	for _, allowedDomain := range strings.Split(*settings.AllowedDomains, ",") {
		if emailDomain == strings.ToLower(strings.TrimSpace(allowedDomain)) {
			return nil
		}
	}
	return fmt.Errorf("openid: email domain %q is not allowed", emailDomain)
}

// GetUserFromJSON parses a standard OIDC userinfo JSON payload.
func (p *OpenIDProvider) GetUserFromJSON(rctx request.CTX, data io.Reader, tokenUser *model.User, settings *model.SSOSettings) (*model.User, error) {
	var ou OpenIDUser
	if err := decodeJSONResponse(data, &ou); err != nil {
		return nil, err
	}
	tokenOIDCUser := openIDUserFromModelUser(tokenUser)
	if tokenOIDCUser != nil {
		if ou.Sub != "" && tokenOIDCUser.Sub != "" && ou.Sub != tokenOIDCUser.Sub {
			return nil, errors.New("openid: userinfo sub does not match id_token sub")
		}
		if ou.Email != "" && tokenOIDCUser.Email != "" && !strings.EqualFold(ou.Email, tokenOIDCUser.Email) {
			return nil, errors.New("openid: userinfo email does not match id_token email")
		}
	}
	ou.mergeFallback(tokenOIDCUser)
	if err := ou.IsValid(); err != nil {
		return nil, err
	}
	if err := validateAllowedEmailDomain(ou.Email, settings); err != nil {
		return nil, err
	}
	return userFromOpenIDUser(rctx.Logger(), &ou, settings), nil
}

// oidcDiscovery is the subset of the OIDC discovery document we need.
type oidcDiscovery struct {
	Issuer                        string   `json:"issuer"`
	AuthorizationEndpoint         string   `json:"authorization_endpoint"`
	TokenEndpoint                 string   `json:"token_endpoint"`
	UserinfoEndpoint              string   `json:"userinfo_endpoint"`
	JwksURI                       string   `json:"jwks_uri"`
	CodeChallengeMethodsSupported []string `json:"code_challenge_methods_supported"`
}

func validateOIDCEndpoint(rawURL, name string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("openid: invalid %s: %w", name, err)
	}
	if parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return fmt.Errorf("openid: %s must be an absolute HTTPS URL without userinfo", name)
	}
	if ip := net.ParseIP(parsed.Hostname()); ip != nil &&
		(ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()) {
		return fmt.Errorf("openid: %s must not target a private or local IP address", name)
	}
	return nil
}

func oidcHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("openid: endpoint %q did not resolve to an IP address", host)
		}
		for _, ip := range ips {
			if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
				return nil, fmt.Errorf("openid: endpoint %q resolves to a private or local address", host)
			}
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}
	return &http.Client{
		Timeout:   10 * time.Second,
		Transport: transport,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func (p *OpenIDProvider) client() *http.Client {
	if p.httpClient != nil {
		return p.httpClient
	}
	return oidcHTTPClient()
}

func decodeJSONResponse(reader io.Reader, target any) error {
	limited := &io.LimitedReader{R: reader, N: maxOIDCResponseSize + 1}
	decoder := json.NewDecoder(limited)
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if limited.N <= 0 {
		return errors.New("openid: response body exceeds size limit")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("openid: response contains multiple JSON values")
		}
		return err
	}
	return nil
}

// fetchDiscovery fetches and validates the OIDC discovery document.
func (p *OpenIDProvider) fetchDiscovery(discoveryURL string) (*oidcDiscovery, error) {
	if err := validateOIDCEndpoint(discoveryURL, "discovery endpoint"); err != nil {
		return nil, err
	}
	resp, err := p.client().Get(discoveryURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("openid discovery: unexpected status " + resp.Status)
	}
	var doc oidcDiscovery
	if err := decodeJSONResponse(resp.Body, &doc); err != nil {
		return nil, err
	}
	endpoints := map[string]string{
		"issuer":                 doc.Issuer,
		"authorization endpoint": doc.AuthorizationEndpoint,
		"token endpoint":         doc.TokenEndpoint,
		"userinfo endpoint":      doc.UserinfoEndpoint,
		"JWKS endpoint":          doc.JwksURI,
	}
	for name, endpoint := range endpoints {
		if endpoint == "" {
			return nil, fmt.Errorf("openid: discovery document is missing %s", name)
		}
		if err := validateOIDCEndpoint(endpoint, name); err != nil {
			return nil, err
		}
	}
	supportsS256 := false
	for _, method := range doc.CodeChallengeMethodsSupported {
		if method == "S256" {
			supportsS256 = true
			break
		}
	}
	if !supportsS256 {
		return nil, errors.New("openid: provider discovery does not advertise PKCE S256 support")
	}
	return &doc, nil
}

// GetSSOSettings returns the OpenIdSettings block from the server config,
// populating all provider endpoints from a validated discovery document.
func (p *OpenIDProvider) GetSSOSettings(rctx request.CTX, config *model.Config, _ string) (*model.SSOSettings, error) {
	s := config.OpenIdSettings // copy so we don't mutate global config

	if s.Id == nil || strings.TrimSpace(*s.Id) == "" {
		return nil, errors.New("openid: client ID is required")
	}
	hasOpenIDScope := false
	if s.Scope != nil {
		for _, scope := range strings.Fields(*s.Scope) {
			if scope == "openid" {
				hasOpenIDScope = true
				break
			}
		}
	}
	if !hasOpenIDScope {
		return nil, errors.New("openid: scope must include openid")
	}
	if s.DiscoveryEndpoint == nil || strings.TrimSpace(*s.DiscoveryEndpoint) == "" {
		return nil, errors.New("openid: DiscoveryEndpoint is required for signed id_token verification")
	}

	discoveryURL := strings.TrimSpace(*s.DiscoveryEndpoint)
	doc, err := p.fetchDiscovery(discoveryURL)
	if err != nil {
		if rctx != nil {
			rctx.Logger().Warn("OpenID: failed to fetch discovery document",
				mlog.String("url", discoveryURL), mlog.Err(err))
		}
		return nil, err
	}

	s.AuthEndpoint = model.NewPointer(doc.AuthorizationEndpoint)
	s.TokenEndpoint = model.NewPointer(doc.TokenEndpoint)
	s.UserAPIEndpoint = model.NewPointer(doc.UserinfoEndpoint)

	return &s, nil
}

// parseJWK converts a JSON Web Key into a Go crypto.PublicKey.
func parseJWK(key jwk) (crypto.PublicKey, error) {
	switch key.Kty {
	case "RSA":
		nBytes, err := base64.RawURLEncoding.DecodeString(key.N)
		if err != nil {
			return nil, fmt.Errorf("openid: invalid RSA n: %w", err)
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(key.E)
		if err != nil {
			return nil, fmt.Errorf("openid: invalid RSA e: %w", err)
		}
		e := new(big.Int).SetBytes(eBytes)
		n := new(big.Int).SetBytes(nBytes)
		if !e.IsInt64() || e.Int64() < 3 || e.Int64()%2 == 0 || n.Sign() <= 0 {
			return nil, errors.New("openid: invalid RSA public key")
		}
		return &rsa.PublicKey{
			N: n,
			E: int(e.Int64()),
		}, nil
	case "EC":
		xBytes, err := base64.RawURLEncoding.DecodeString(key.X)
		if err != nil {
			return nil, fmt.Errorf("openid: invalid EC x: %w", err)
		}
		yBytes, err := base64.RawURLEncoding.DecodeString(key.Y)
		if err != nil {
			return nil, fmt.Errorf("openid: invalid EC y: %w", err)
		}
		var curve elliptic.Curve
		switch key.Crv {
		case "P-256":
			curve = elliptic.P256()
		case "P-384":
			curve = elliptic.P384()
		case "P-521":
			curve = elliptic.P521()
		default:
			return nil, fmt.Errorf("openid: unsupported EC curve %q", key.Crv)
		}
		x := new(big.Int).SetBytes(xBytes)
		y := new(big.Int).SetBytes(yBytes)
		if !curve.IsOnCurve(x, y) {
			return nil, errors.New("openid: EC point is not on the declared curve")
		}
		return &ecdsa.PublicKey{
			Curve: curve,
			X:     x,
			Y:     y,
		}, nil
	default:
		return nil, fmt.Errorf("openid: unsupported JWK key type %q", key.Kty)
	}
}

// getJWKS returns the key set cached for this exact JWKS URI, or fetches it.
func (p *OpenIDProvider) getJWKS(uri string, forceRefresh bool) (map[string]crypto.PublicKey, error) {
	p.mu.RLock()
	cache := p.jwksCache[uri]
	p.mu.RUnlock()

	if !forceRefresh && cache != nil && time.Since(cache.fetchedAt) < jwksCacheTTL {
		return cache.keys, nil
	}

	if err := validateOIDCEndpoint(uri, "JWKS endpoint"); err != nil {
		return nil, err
	}
	resp, err := p.client().Get(uri)
	if err != nil {
		return nil, fmt.Errorf("openid: jwks fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openid: jwks fetch: status %s", resp.Status)
	}

	var set jwkSet
	if err := decodeJSONResponse(resp.Body, &set); err != nil {
		return nil, fmt.Errorf("openid: jwks decode: %w", err)
	}

	keys := make(map[string]crypto.PublicKey, len(set.Keys))
	for _, k := range set.Keys {
		if k.Use != "" && k.Use != "sig" {
			continue
		}
		pub, err := parseJWK(k)
		if err != nil {
			continue // skip unsupported key types without aborting
		}
		keys[k.Kid] = pub
	}
	if len(keys) == 0 {
		return nil, errors.New("openid: JWKS endpoint returned no supported signing keys")
	}

	p.mu.Lock()
	if p.jwksCache == nil {
		p.jwksCache = make(map[string]*jwksCacheEntry)
	}
	p.jwksCache[uri] = &jwksCacheEntry{keys: keys, fetchedAt: time.Now()}
	p.mu.Unlock()

	return keys, nil
}

// verifyToken validates signature, algorithm, issuer, audience, expiry and nonce.
func (p *OpenIDProvider) verifyToken(idToken string, keys map[string]crypto.PublicKey, issuer, clientID, expectedNonce string) (*openIDClaims, error) {
	if issuer == "" || clientID == "" || expectedNonce == "" {
		return nil, errors.New("openid: issuer, client ID and nonce are required for id_token verification")
	}
	var claims openIDClaims
	_, err := jwtv5.ParseWithClaims(idToken, &claims, func(token *jwtv5.Token) (interface{}, error) {
		kid, _ := token.Header["kid"].(string)
		if pub, ok := keys[kid]; ok {
			return pub, nil
		}
		// Some providers omit kid when the JWKS has only one key.
		if len(keys) == 1 {
			for _, pub := range keys {
				return pub, nil
			}
		}
		return nil, fmt.Errorf("openid: no JWK found for kid %q", kid)
	},
		jwtv5.WithValidMethods([]string{
			jwtv5.SigningMethodRS256.Alg(),
			jwtv5.SigningMethodRS384.Alg(),
			jwtv5.SigningMethodRS512.Alg(),
			jwtv5.SigningMethodES256.Alg(),
			jwtv5.SigningMethodES384.Alg(),
			jwtv5.SigningMethodES512.Alg(),
		}),
		jwtv5.WithExpirationRequired(),
		jwtv5.WithIssuer(issuer),
		jwtv5.WithAudience(clientID),
	)
	if err != nil {
		return nil, err
	}

	if claims.Nonce != expectedNonce {
		return nil, errors.New("openid: id_token nonce mismatch")
	}
	if len(claims.Audience) > 1 && claims.AuthorizedParty == "" {
		return nil, errors.New("openid: id_token with multiple audiences is missing azp")
	}
	if claims.AuthorizedParty != "" && claims.AuthorizedParty != clientID {
		return nil, errors.New("openid: id_token azp does not match client ID")
	}
	if claims.Email != "" && (claims.EmailVerified == nil || !*claims.EmailVerified) {
		return nil, errors.New("openid: id_token email is not verified")
	}

	return &claims, nil
}

// GetUserFromIdToken verifies the id_token signature using the provider's JWKS
// and extracts standard OIDC profile claims. On key-ID mismatch the JWKS cache
// is invalidated and the fetch retried once to handle seamless key rotation.
func (p *OpenIDProvider) GetUserFromIdToken(rctx request.CTX, idToken string, settings *model.SSOSettings, expectedNonce string) (*model.User, error) {
	if settings == nil || settings.DiscoveryEndpoint == nil || settings.Id == nil {
		return nil, errors.New("openid: incomplete settings for id_token verification")
	}

	doc, err := p.fetchDiscovery(*settings.DiscoveryEndpoint)
	if err != nil {
		return nil, err
	}
	keys, err := p.getJWKS(doc.JwksURI, false)
	if err != nil {
		return nil, err
	}

	claims, err := p.verifyToken(idToken, keys, doc.Issuer, *settings.Id, expectedNonce)
	if err != nil {
		// Refresh once to handle normal provider key rotation.
		keys, err2 := p.getJWKS(doc.JwksURI, true)
		if err2 != nil {
			return nil, fmt.Errorf("openid: id_token verification failed: %w", err)
		}
		claims, err = p.verifyToken(idToken, keys, doc.Issuer, *settings.Id, expectedNonce)
		if err != nil {
			return nil, fmt.Errorf("openid: id_token verification failed: %w", err)
		}
	}

	ou := &OpenIDUser{
		Sub:               claims.Subject,
		Email:             claims.Email,
		Name:              claims.Name,
		GivenName:         claims.GivenName,
		FamilyName:        claims.FamilyName,
		PreferredUsername: claims.PreferredUsername,
		EmailVerified:     claims.EmailVerified,
	}
	if err := ou.hasAuthData(); err != nil {
		return nil, err
	}
	if err := validateAllowedEmailDomain(ou.Email, settings); err != nil {
		return nil, err
	}
	return userFromOpenIDUser(rctx.Logger(), ou, nil), nil
}

// IsSameUser compares the stable sub claim stored as AuthData.
func (p *OpenIDProvider) IsSameUser(_ request.CTX, dbUser, oauthUser *model.User) bool {
	return dbUser.AuthData != nil && oauthUser.AuthData != nil &&
		*dbUser.AuthData == *oauthUser.AuthData
}
