// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {
    useCallback,
    useEffect,
    useMemo,
    useState,
    useRef,
} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {shallowEqual, useSelector, useDispatch} from 'react-redux';

import {GenericModal} from '@mattermost/components';
import type {Channel} from '@mattermost/types/channels';

import Permissions from 'mattermost-redux/constants/permissions';
import {getChannel} from 'mattermost-redux/selectors/entities/channels';
import {getConfig, getLicense} from 'mattermost-redux/selectors/entities/general';
import {haveIChannelPermission, haveISystemPermission} from 'mattermost-redux/selectors/entities/roles';

import {
    setShowPreviewOnChannelSettingsHeaderModal,
    setShowPreviewOnChannelSettingsPurposeModal,
} from 'actions/views/textbox';
import {getBasePath, isChannelAccessControlEnabled} from 'selectors/general';
import {getChannelSettingsTabs} from 'selectors/plugins';

import type {Tab as SidebarTab} from 'components/settings_sidebar/settings_sidebar';
import {normalizePluginIcon} from 'components/settings_sidebar/settings_sidebar';
import SaveChangesPanel from 'components/widgets/modals/components/save_changes_panel';

import Pluggable from 'plugins/pluggable';
import {focusElement} from 'utils/a11y_utils';
import Constants from 'utils/constants';
import {isMinimumEnterpriseAdvancedLicense} from 'utils/license_utils';

import type {ChannelSettingsTabSaveBarHandlers} from 'types/plugins/channel_settings';
import type {GlobalState} from 'types/store';
import type {ChannelSettingsTabComponent} from 'types/store/plugins';

import ChannelSettingsAccessRulesTab from './channel_settings_access_rules_tab';
import ChannelSettingsArchiveTab from './channel_settings_archive_tab';
import ChannelSettingsConfigurationTab from './channel_settings_configuration_tab';
import ChannelSettingsInfoTab from './channel_settings_info_tab';

import './channel_settings_modal.scss';

// Lazy-loaded components
const SettingsSidebar = React.lazy(() => import('components/settings_sidebar'));

type ChannelSettingsModalProps = {
    channelId: string;
    onExited: () => void;
    isOpen: boolean;
    focusOriginElement?: string;
};

const BuiltInTabIds = {
    INFO: 'info',
    ACCESS_RULES: 'access_rules',
    CONFIGURATION: 'configuration',
    ARCHIVE: 'archive',
} as const;
type BuiltInTabId = typeof BuiltInTabIds[keyof typeof BuiltInTabIds];

const builtInTabIdSet = new Set<BuiltInTabId>(Object.values(BuiltInTabIds));
const PLUGIN_TAB_PREFIX = 'plugin_';

const SHOW_PANEL_ERROR_STATE_TAB_SWITCH_TIMEOUT = 3000;

function getPluginTabName(registrationId: string): string {
    return `${PLUGIN_TAB_PREFIX}${registrationId}`;
}

function getPluginRegistrationId(tabName: string): string | undefined {
    if (!tabName.startsWith(PLUGIN_TAB_PREFIX)) {
        return undefined;
    }

    const registrationId = tabName.slice(PLUGIN_TAB_PREFIX.length);
    return registrationId || undefined;
}

function isBuiltInTabId(tabName: string): tabName is BuiltInTabId {
    return builtInTabIdSet.has(tabName as BuiltInTabId);
}

function getPreferredActiveTab(activeTab: string, visibleBuiltInTabs: SidebarTab[], visiblePluginTabs: SidebarTab[]): string {
    const visibleTabNames = [...visibleBuiltInTabs, ...visiblePluginTabs].map((tab) => tab.name);
    if (visibleTabNames.includes(activeTab)) {
        return activeTab;
    }

    return visibleBuiltInTabs[0]?.name ?? visiblePluginTabs[0]?.name ?? BuiltInTabIds.INFO;
}

function getFirstVisibleTab(shouldShowInfoTab: boolean, shouldShowAccessRulesTab: boolean, shouldShowConfigurationTab: boolean, shouldShowArchiveTab: boolean) {
    if (shouldShowInfoTab) {
        return BuiltInTabIds.INFO;
    }
    if (shouldShowAccessRulesTab) {
        return BuiltInTabIds.ACCESS_RULES;
    }
    if (shouldShowConfigurationTab) {
        return BuiltInTabIds.CONFIGURATION;
    }
    if (shouldShowArchiveTab) {
        return BuiltInTabIds.ARCHIVE;
    }
    return BuiltInTabIds.INFO;
}

type ChannelSettingsPluginTabProps = {
    channel: Channel;
    pluginRegistration: ChannelSettingsTabComponent;
    areThereUnsavedChanges: boolean;
    showTabSwitchError: boolean;
    registerPluginSaveBarHandlers: (handlers: ChannelSettingsTabSaveBarHandlers | null) => void;
    setPluginUnsavedChanges: (unsaved: boolean) => void;
    handlePluginSaveBarSubmit: () => void;
    handlePluginSaveBarCancel: () => void;
    handlePluginSaveBarClose: () => void;
};

function ChannelSettingsPluginTab({
    channel,
    pluginRegistration,
    areThereUnsavedChanges,
    showTabSwitchError,
    registerPluginSaveBarHandlers,
    setPluginUnsavedChanges,
    handlePluginSaveBarSubmit,
    handlePluginSaveBarCancel,
    handlePluginSaveBarClose,
}: ChannelSettingsPluginTabProps) {
    return (
        <>
            <div className='ChannelSettingsModal__pluginTab'>
                <Pluggable
                    pluggableName='ChannelSettingsTab'
                    pluggableId={pluginRegistration.id}
                    channel={channel}
                    setAreThereUnsavedChanges={setPluginUnsavedChanges}
                    registerSaveBarHandlers={registerPluginSaveBarHandlers}
                />
            </div>
            {areThereUnsavedChanges && (
                <SaveChangesPanel
                    handleSubmit={handlePluginSaveBarSubmit}
                    handleCancel={handlePluginSaveBarCancel}
                    handleClose={handlePluginSaveBarClose}
                    tabChangeError={showTabSwitchError}
                    state={showTabSwitchError ? 'error' : 'editing'}
                    cancelButtonText={
                        <FormattedMessage
                            id='channel_settings.save_changes_panel.reset'
                            defaultMessage='Reset'
                        />
                    }
                />
            )}
        </>
    );
}

function ChannelSettingsModal({channelId, isOpen, onExited, focusOriginElement}: ChannelSettingsModalProps) {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const channel = useSelector((state: GlobalState) => getChannel(state, channelId)) as Channel;
    const visiblePluginTabRegistrations = useSelector((state: GlobalState) => {
        const currentChannel = getChannel(state, channelId);
        if (!currentChannel) {
            return [];
        }

        return getChannelSettingsTabs(state).filter((registration) => registration.shouldRender?.(state, currentChannel) ?? true);
    }, shallowEqual);
    const isDMorGM = channel.type === Constants.DM_CHANNEL || channel.type === Constants.GM_CHANNEL;
    const channelBannerEnabled = isMinimumEnterpriseAdvancedLicense(useSelector(getLicense));

    const canManagePublicChannelBanner = useSelector((state: GlobalState) =>
        haveIChannelPermission(state, channel.team_id, channel.id, Permissions.MANAGE_PUBLIC_CHANNEL_BANNER),
    );
    const canManagePrivateChannelBanner = useSelector((state: GlobalState) =>
        haveIChannelPermission(state, channel.team_id, channel.id, Permissions.MANAGE_PRIVATE_CHANNEL_BANNER),
    );
    const hasManageChannelBannerPermission = (channel.type === 'O' && canManagePublicChannelBanner) || (channel.type === 'P' && canManagePrivateChannelBanner);

    const canManageChannelTranslation = useSelector((state: GlobalState) => {
        const config = getConfig(state);
        if (config?.EnableAutoTranslation !== 'true') {
            return false;
        }

        const isDMorGM = channel.type === Constants.DM_CHANNEL || channel.type === Constants.GM_CHANNEL;
        if (isDMorGM && config?.RestrictDMAndGMAutotranslation === 'true') {
            return false;
        }

        const permissionToCheck = channel.type === Constants.PRIVATE_CHANNEL ? Permissions.MANAGE_PRIVATE_CHANNEL_AUTO_TRANSLATION : Permissions.MANAGE_PUBLIC_CHANNEL_AUTO_TRANSLATION;
        return haveIChannelPermission(state, channel.team_id, channel.id, permissionToCheck);
    });

    const canManageBanner = channelBannerEnabled && hasManageChannelBannerPermission;
    const canManageSharedChannels = useSelector((state: GlobalState) => {
        const config = getConfig(state);
        const connectedWorkspacesEnabled = config?.ExperimentalSharedChannels === 'true';
        if (!connectedWorkspacesEnabled || isDMorGM) {
            return false;
        }
        return haveISystemPermission(state, {permission: Permissions.MANAGE_SHARED_CHANNELS});
    });
    const shouldShowConfigurationTab = canManageBanner || canManageChannelTranslation || canManageSharedChannels;

    const canManageChannelProperties = useSelector((state: GlobalState) => {
        if (isDMorGM) {
            return true;
        }
        const permission = channel.type === Constants.PRIVATE_CHANNEL ? Permissions.MANAGE_PRIVATE_CHANNEL_PROPERTIES : Permissions.MANAGE_PUBLIC_CHANNEL_PROPERTIES;
        return haveIChannelPermission(state, channel.team_id, channel.id, permission);
    });
    const shouldShowInfoTab = canManageChannelProperties;

    const canArchivePrivateChannels = useSelector((state: GlobalState) =>
        haveIChannelPermission(state, channel.team_id, channel.id, Permissions.DELETE_PRIVATE_CHANNEL),
    );

    const canArchivePublicChannels = useSelector((state: GlobalState) =>
        haveIChannelPermission(state, channel.team_id, channel.id, Permissions.DELETE_PUBLIC_CHANNEL),
    );

    const canManageChannelAccessRules = useSelector((state: GlobalState) =>
        haveIChannelPermission(state, channel.team_id, channel.id, Permissions.MANAGE_CHANNEL_ACCESS_RULES),
    );

    const basePath = useSelector(getBasePath);
    const channelAdminABACControlEnabled = useSelector(isChannelAccessControlEnabled);

    const isPolicyEligibleChannelType = channel.type === Constants.PRIVATE_CHANNEL || channel.type === Constants.OPEN_CHANNEL;

    // Default channels (town-square / off-topic) cannot have ABAC policies —
    // ValidateChannelEligibilityForAccessControl rejects them on the server, so
    // showing the Membership Policy tab here would only let the user assemble
    // rules they can never save.
    const isDefaultChannel = channel.name === Constants.DEFAULT_CHANNEL || channel.name === Constants.OFFTOPIC_CHANNEL;
    const shouldShowAccessRulesTab = channelAdminABACControlEnabled && canManageChannelAccessRules && isPolicyEligibleChannelType && !channel.group_constrained && !isDefaultChannel && !channel.shared;

    const shouldShowArchiveTab = channel.name !== Constants.DEFAULT_CHANNEL &&
        ((channel.type === Constants.PRIVATE_CHANNEL && canArchivePrivateChannels) ||
        (channel.type === Constants.OPEN_CHANNEL && canArchivePublicChannels));

    const [show, setShow] = useState(isOpen);

    // First visible tab (in tab order) for when Info is not available
    const firstVisibleTab = getFirstVisibleTab(shouldShowInfoTab, shouldShowAccessRulesTab, shouldShowConfigurationTab, shouldShowArchiveTab);

    // Active tab
    const [activeTab, setActiveTab] = useState<string>(firstVisibleTab);

    // State for showing error in the save changes panel when trying to switch tabs with unsaved changes
    const [showTabSwitchError, setShowTabSwitchError] = useState(false);

    // State to track if there are unsaved changes
    const [areThereUnsavedChanges, setAreThereUnsavedChanges] = useState(false);

    // State to track if user has been warned about unsaved changes
    const [hasBeenWarned, setHasBeenWarned] = useState(false);

    // Refs
    const modalBodyRef = useRef<HTMLDivElement>(null);
    const pluginSaveBarHandlersRef = useRef<ChannelSettingsTabSaveBarHandlers | null>(null);

    const tabs = useMemo((): SidebarTab[] => {
        return [
            {
                name: BuiltInTabIds.INFO,
                uiName: formatMessage({id: 'channel_settings.tab.info', defaultMessage: 'Info'}),
                icon: 'icon icon-information-outline',
                iconTitle: formatMessage({id: 'generic_icons.info', defaultMessage: 'Info Icon'}),
                display: shouldShowInfoTab,
            },
            {
                name: BuiltInTabIds.ACCESS_RULES,
                uiName: formatMessage({id: 'channel_settings.tab.membership_policy', defaultMessage: 'Membership Policy'}),
                icon: 'icon icon-shield-outline',
                iconTitle: formatMessage({id: 'generic_icons.access_rules', defaultMessage: 'Membership Policy Icon'}),
                display: shouldShowAccessRulesTab,
            },
            {
                name: BuiltInTabIds.CONFIGURATION,
                uiName: formatMessage({id: 'channel_settings.tab.configuration', defaultMessage: 'Configuration'}),
                icon: 'icon icon-cog-outline',
                iconTitle: formatMessage({id: 'generic_icons.settings', defaultMessage: 'Settings Icon'}),
                display: shouldShowConfigurationTab,
            },
            {
                name: BuiltInTabIds.ARCHIVE,
                uiName: formatMessage({id: 'channel_settings.tab.archive', defaultMessage: 'Archive Channel'}),
                icon: 'icon icon-archive-outline',
                iconTitle: formatMessage({id: 'generic_icons.archive', defaultMessage: 'Archive Icon'}),
                display: channel.name !== Constants.DEFAULT_CHANNEL &&
                    ((channel.type === Constants.PRIVATE_CHANNEL && canArchivePrivateChannels) ||
                    (channel.type === Constants.OPEN_CHANNEL && canArchivePublicChannels)),
            },
        ];
    }, [
        canArchivePrivateChannels,
        canArchivePublicChannels,
        channel.name,
        channel.type,
        formatMessage,
        shouldShowInfoTab,
        shouldShowAccessRulesTab,
        shouldShowConfigurationTab,
    ]);

    const pluginTabs = useMemo((): SidebarTab[] => {
        return visiblePluginTabRegistrations.map((registration) => {
            return {
                name: getPluginTabName(registration.id),
                uiName: registration.uiName,
                iconTitle: registration.uiName,
                icon: normalizePluginIcon(registration.icon, basePath),
            };
        });
    }, [basePath, visiblePluginTabRegistrations]);

    const visibleBuiltInTabs = useMemo(() => tabs.filter((tab) => tab.display !== false), [tabs]);
    const visiblePluginTabs = useMemo(() => pluginTabs.filter((tab) => tab.display !== false), [pluginTabs]);
    const preferredActiveTab = useMemo(() => getPreferredActiveTab(activeTab, visibleBuiltInTabs, visiblePluginTabs), [activeTab, visibleBuiltInTabs, visiblePluginTabs]);
    const activePluginRegistrationId = getPluginRegistrationId(activeTab);
    const visibleActivePluginRegistration = useMemo(() => {
        if (!activePluginRegistrationId) {
            return undefined;
        }

        return visiblePluginTabRegistrations.find((registration) => registration.id === activePluginRegistrationId);
    }, [activePluginRegistrationId, visiblePluginTabRegistrations]);

    const lastActivePluginRegistrationRef = useRef<ChannelSettingsTabComponent | undefined>(visibleActivePluginRegistration);

    const clearPluginSaveBarHandlers = useCallback(() => {
        pluginSaveBarHandlersRef.current = null;
    }, []);

    const registerPluginSaveBarHandlers = useCallback((handlers: ChannelSettingsTabSaveBarHandlers | null) => {
        pluginSaveBarHandlersRef.current = handlers;
    }, []);

    const setPluginUnsavedChanges = useCallback((unsaved: boolean) => {
        setAreThereUnsavedChanges(unsaved);
        if (!unsaved) {
            setHasBeenWarned(false);
        }
    }, []);

    const handlePluginSaveBarSubmit = useCallback(async () => {
        const handlers = pluginSaveBarHandlersRef.current;
        if (!handlers) {
            return;
        }
        try {
            await handlers.save();
            setPluginUnsavedChanges(false);
        } catch {
            // The plugin owns user-visible errors; dirty state remains until the plugin clears it.
        }
    }, [setPluginUnsavedChanges]);

    const handlePluginSaveBarCancel = useCallback(() => {
        pluginSaveBarHandlersRef.current?.reset();
        setPluginUnsavedChanges(false);
    }, [setPluginUnsavedChanges]);

    const handlePluginSaveBarClose = useCallback(() => {
        // Host does not use the transient 'saved' state for plugin tabs.
    }, []);

    useEffect(() => {
        if (visibleActivePluginRegistration) {
            lastActivePluginRegistrationRef.current = visibleActivePluginRegistration;
            return;
        }

        if (!areThereUnsavedChanges) {
            clearPluginSaveBarHandlers();
        }
    }, [areThereUnsavedChanges, visibleActivePluginRegistration, clearPluginSaveBarHandlers]);

    useEffect(() => {
        if (preferredActiveTab !== activeTab && !areThereUnsavedChanges) {
            clearPluginSaveBarHandlers();
            setActiveTab(preferredActiveTab);
        }
    }, [activeTab, preferredActiveTab, areThereUnsavedChanges, clearPluginSaveBarHandlers]);

    // Called to set the active tab, prompting save changes panel if there are unsaved changes
    const updateTab = (newTab: string) => {
        /**
         * If there are unsaved changes, show an error in the save changes panel
         * and reset it after a timeout to indicate the user needs to save or discard changes
         * before switching tabs.
         */
        if (areThereUnsavedChanges) {
            setShowTabSwitchError(true);
            setTimeout(() => {
                setShowTabSwitchError(false);
            }, SHOW_PANEL_ERROR_STATE_TAB_SWITCH_TIMEOUT);
            return;
        }

        if (newTab !== activeTab) {
            clearPluginSaveBarHandlers();
            setActiveTab(newTab);
        }

        if (modalBodyRef.current) {
            modalBodyRef.current.scrollTop = 0;
        }
    };

    const handleHide = () => {
        // Prevent modal closing if there are unsaved changes (warn once, then allow)
        if (areThereUnsavedChanges && !hasBeenWarned) {
            setHasBeenWarned(true);

            // Show error message in SaveChangesPanel
            setShowTabSwitchError(true);
            setTimeout(() => {
                setShowTabSwitchError(false);
            }, SHOW_PANEL_ERROR_STATE_TAB_SWITCH_TIMEOUT);
        } else {
            handleHideConfirm();
        }
    };

    const handleHideConfirm = () => {
        // Reset preview states to false when closing the modal
        dispatch(setShowPreviewOnChannelSettingsHeaderModal(false));
        dispatch(setShowPreviewOnChannelSettingsPurposeModal(false));
        setShow(false);
    };

    // Called after the fade-out completes
    const handleExited = () => {
        // Clear anything if needed
        setActiveTab(BuiltInTabIds.INFO);
        setHasBeenWarned(false);
        clearPluginSaveBarHandlers();
        if (focusOriginElement) {
            focusElement(focusOriginElement, true);
        }
        onExited();
    };

    const renderInfoTab = () => {
        return (
            <ChannelSettingsInfoTab
                channel={channel}
                setAreThereUnsavedChanges={setAreThereUnsavedChanges}
                showTabSwitchError={showTabSwitchError}
            />
        );
    };

    const renderConfigurationTab = () => {
        return (
            <ChannelSettingsConfigurationTab
                channel={channel}
                setAreThereUnsavedChanges={setAreThereUnsavedChanges}
                showTabSwitchError={showTabSwitchError}
                canManageChannelTranslation={canManageChannelTranslation}
                canManageBanner={canManageBanner}
                canManageSharedChannels={canManageSharedChannels}
            />
        );
    };

    const renderAccessRulesTab = () => {
        return (
            <ChannelSettingsAccessRulesTab
                channel={channel}
                setAreThereUnsavedChanges={setAreThereUnsavedChanges}
                showTabSwitchError={showTabSwitchError}
            />
        );
    };

    const renderArchiveTab = () => {
        return (
            <ChannelSettingsArchiveTab
                channel={channel}
                onHide={handleHideConfirm}
            />
        );
    };

    const renderBuiltInTabContent = (tab: BuiltInTabId) => {
        switch (tab) {
        case BuiltInTabIds.INFO:
            return renderInfoTab();
        case BuiltInTabIds.ACCESS_RULES:
            return renderAccessRulesTab();
        case BuiltInTabIds.CONFIGURATION:
            return renderConfigurationTab();
        case BuiltInTabIds.ARCHIVE:
            return renderArchiveTab();
        default: {
            const exhaustiveCheck: never = tab;
            return exhaustiveCheck;
        }
        }
    };

    // Renders content based on active tab
    const renderTabContent = () => {
        const lastActivePluginRegistration = lastActivePluginRegistrationRef.current;
        const pluginRegistration = visibleActivePluginRegistration ??
            (areThereUnsavedChanges && activePluginRegistrationId && lastActivePluginRegistration?.id === activePluginRegistrationId ? lastActivePluginRegistration : undefined);

        if (pluginRegistration) {
            return (
                <ChannelSettingsPluginTab
                    channel={channel}
                    pluginRegistration={pluginRegistration}
                    areThereUnsavedChanges={areThereUnsavedChanges}
                    showTabSwitchError={showTabSwitchError}
                    registerPluginSaveBarHandlers={registerPluginSaveBarHandlers}
                    setPluginUnsavedChanges={setPluginUnsavedChanges}
                    handlePluginSaveBarSubmit={handlePluginSaveBarSubmit}
                    handlePluginSaveBarCancel={handlePluginSaveBarCancel}
                    handlePluginSaveBarClose={handlePluginSaveBarClose}
                />
            );
        }

        return renderBuiltInTabContent(isBuiltInTabId(activeTab) ? activeTab : BuiltInTabIds.INFO);
    };

    // Renders the body: left sidebar for tabs, the content on the right
    const renderModalBody = () => {
        return (
            <div
                ref={modalBodyRef}
                className='settings-table'
            >
                <div className='settings-links'>
                    <React.Suspense fallback={null}>
                        <SettingsSidebar
                            tabs={tabs}
                            pluginTabs={pluginTabs}
                            activeTab={activeTab}
                            updateTab={updateTab}
                        />
                    </React.Suspense>
                </div>
                <div className='settings-content minimize-settings'>
                    {renderTabContent()}
                </div>
            </div>
        );
    };

    const modalTitle = formatMessage({id: 'channel_settings.modal.title', defaultMessage: 'Channel Settings'});

    return (
        <GenericModal
            id='channelSettingsModal'
            ariaLabel={modalTitle}
            className='ChannelSettingsModal settings-modal'
            show={show}
            onHide={handleHide}
            preventClose={areThereUnsavedChanges && !hasBeenWarned}
            onExited={handleExited}
            compassDesign={true}
            modalHeaderText={modalTitle}
            bodyPadding={false}
            modalLocation={'top'}
            enforceFocus={false}
        >
            <div className='ChannelSettingsModal__bodyWrapper'>
                {renderModalBody()}
            </div>
        </GenericModal>
    );
}

export default ChannelSettingsModal;
