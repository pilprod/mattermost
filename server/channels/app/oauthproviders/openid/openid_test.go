// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package oauthopenid

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"strings"
	"testing"
	"time"

	jwtv5 "github.com/golang-jwt/jwt/v5"
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testIssuer   = "https://accounts.example.com"
	testClientID = "mattermost-client"
	testNonce    = "expected-nonce"
)

func signedIDToken(t *testing.T, key *rsa.PrivateKey, mutate func(*openIDClaims)) string {
	t.Helper()

	claims := &openIDClaims{
		Email:         "user@example.com",
		EmailVerified: model.NewPointer(true),
		Nonce:         testNonce,
		RegisteredClaims: jwtv5.RegisteredClaims{
			Issuer:    testIssuer,
			Subject:   "stable-subject",
			Audience:  jwtv5.ClaimStrings{testClientID},
			ExpiresAt: jwtv5.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	if mutate != nil {
		mutate(claims)
	}

	token := jwtv5.NewWithClaims(jwtv5.SigningMethodRS256, claims)
	token.Header["kid"] = "test-key"
	signed, err := token.SignedString(key)
	require.NoError(t, err)
	return signed
}

func TestVerifyTokenRequiresOIDCSecurityClaims(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	provider := &OpenIDProvider{}
	keys := map[string]crypto.PublicKey{"test-key": &key.PublicKey}

	t.Run("accepts valid token", func(t *testing.T) {
		claims, err := provider.verifyToken(signedIDToken(t, key, nil), keys, testIssuer, testClientID, testNonce)
		require.NoError(t, err)
		assert.Equal(t, "stable-subject", claims.Subject)
	})

	tests := []struct {
		name   string
		mutate func(*openIDClaims)
	}{
		{
			name: "wrong issuer",
			mutate: func(claims *openIDClaims) {
				claims.Issuer = "https://attacker.example.com"
			},
		},
		{
			name: "wrong audience",
			mutate: func(claims *openIDClaims) {
				claims.Audience = jwtv5.ClaimStrings{"different-client"}
			},
		},
		{
			name: "wrong nonce",
			mutate: func(claims *openIDClaims) {
				claims.Nonce = "different-nonce"
			},
		},
		{
			name: "missing expiry",
			mutate: func(claims *openIDClaims) {
				claims.ExpiresAt = nil
			},
		},
		{
			name: "unverified email",
			mutate: func(claims *openIDClaims) {
				claims.EmailVerified = model.NewPointer(false)
			},
		},
		{
			name: "multiple audiences without azp",
			mutate: func(claims *openIDClaims) {
				claims.Audience = jwtv5.ClaimStrings{testClientID, "other-client"}
			},
		},
		{
			name: "wrong azp",
			mutate: func(claims *openIDClaims) {
				claims.AuthorizedParty = "other-client"
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := provider.verifyToken(signedIDToken(t, key, test.mutate), keys, testIssuer, testClientID, testNonce)
			require.Error(t, err)
		})
	}

	t.Run("rejects missing expected nonce", func(t *testing.T) {
		_, err := provider.verifyToken(signedIDToken(t, key, nil), keys, testIssuer, testClientID, "")
		require.Error(t, err)
	})

	t.Run("rejects alg none", func(t *testing.T) {
		claims := &openIDClaims{
			Nonce: testNonce,
			RegisteredClaims: jwtv5.RegisteredClaims{
				Issuer:    testIssuer,
				Subject:   "stable-subject",
				Audience:  jwtv5.ClaimStrings{testClientID},
				ExpiresAt: jwtv5.NewNumericDate(time.Now().Add(time.Hour)),
			},
		}
		token := jwtv5.NewWithClaims(jwtv5.SigningMethodNone, claims)
		unsigned, err := token.SignedString(jwtv5.UnsafeAllowNoneSignatureType)
		require.NoError(t, err)

		_, err = provider.verifyToken(unsigned, keys, testIssuer, testClientID, testNonce)
		require.Error(t, err)
	})
}

func TestGetUserFromJSONBindsUserinfoToIDToken(t *testing.T) {
	rctx := request.TestContext(t)
	provider := &OpenIDProvider{}
	tokenUser := &model.User{
		Email:         "user@example.com",
		EmailVerified: true,
		AuthData:      model.NewPointer("stable-subject"),
	}

	t.Run("accepts matching verified identity", func(t *testing.T) {
		user, err := provider.GetUserFromJSON(
			rctx,
			strings.NewReader(`{"sub":"stable-subject","email":"user@example.com","email_verified":true}`),
			tokenUser,
			&model.SSOSettings{},
		)
		require.NoError(t, err)
		assert.True(t, user.EmailVerified)
		assert.Equal(t, "stable-subject", *user.AuthData)
	})

	t.Run("rejects subject mismatch", func(t *testing.T) {
		_, err := provider.GetUserFromJSON(
			rctx,
			strings.NewReader(`{"sub":"attacker-subject","email":"user@example.com","email_verified":true}`),
			tokenUser,
			&model.SSOSettings{},
		)
		require.ErrorContains(t, err, "sub does not match")
	})

	t.Run("rejects email mismatch", func(t *testing.T) {
		_, err := provider.GetUserFromJSON(
			rctx,
			strings.NewReader(`{"sub":"stable-subject","email":"attacker@example.com","email_verified":true}`),
			tokenUser,
			&model.SSOSettings{},
		)
		require.ErrorContains(t, err, "email does not match")
	})

	t.Run("rejects unverified userinfo without id token", func(t *testing.T) {
		_, err := provider.GetUserFromJSON(
			rctx,
			strings.NewReader(`{"sub":"stable-subject","email":"user@example.com"}`),
			nil,
			&model.SSOSettings{},
		)
		require.ErrorContains(t, err, "not verified")
	})
}

func TestGetSSOSettingsFailsClosedWithoutDiscovery(t *testing.T) {
	provider := &OpenIDProvider{}
	config := &model.Config{}
	config.SetDefaults()
	config.OpenIdSettings.Id = model.NewPointer(testClientID)
	config.OpenIdSettings.Scope = model.NewPointer("openid email profile")

	_, err := provider.GetSSOSettings(request.TestContext(t), config, model.ServiceOpenid)
	require.ErrorContains(t, err, "DiscoveryEndpoint is required")
}

func TestValidateOIDCEndpoint(t *testing.T) {
	require.NoError(t, validateOIDCEndpoint("https://accounts.example.com/.well-known/openid-configuration", "discovery endpoint"))

	for _, endpoint := range []string{
		"http://accounts.example.com/.well-known/openid-configuration",
		"https://127.0.0.1/.well-known/openid-configuration",
		"https://169.254.169.254/latest/meta-data",
		"https://user:password@accounts.example.com",
	} {
		t.Run(endpoint, func(t *testing.T) {
			require.Error(t, validateOIDCEndpoint(endpoint, "test endpoint"))
		})
	}
}

func TestValidateAllowedEmailDomain(t *testing.T) {
	settings := &model.SSOSettings{AllowedDomains: model.NewPointer("example.com, subsidiary.example")}

	require.NoError(t, validateAllowedEmailDomain("user@EXAMPLE.com", settings))
	require.NoError(t, validateAllowedEmailDomain("user@subsidiary.example", settings))
	require.ErrorContains(t, validateAllowedEmailDomain("user@attacker.example", settings), "not allowed")
	require.Error(t, validateAllowedEmailDomain("not-an-email", settings))
	require.NoError(t, validateAllowedEmailDomain("user@any.example", &model.SSOSettings{}))
}
