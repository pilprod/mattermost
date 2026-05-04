// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type React from 'react';

import type {Channel} from '@mattermost/types/channels';

import type {GlobalState} from 'types/store';

export type ChannelSettingsTabSaveBarHandlers = {

    /** Saves the plugin tab's pending changes. Reject to keep the tab dirty and let the plugin display an error. */
    save: () => Promise<void>;

    /** Restores the plugin tab to its last saved state when the user clicks Reset. */
    reset: () => void;
};

export type ChannelSettingsTabProps = {

    /** The current channel being configured in the modal. */
    channel: Channel;

    /** Notifies the modal when this tab has unsaved changes. */
    setAreThereUnsavedChanges?: (unsaved: boolean) => void;

    /**
     * Registers optional handlers for the host-managed SaveChangesPanel.
     * Register handlers before reporting unsaved changes so Save and Reset can run plugin logic.
     * Pass `null` if handlers no longer apply; the host also clears stale handlers when the active tab changes.
     */
    registerSaveBarHandlers?: (handlers: ChannelSettingsTabSaveBarHandlers | null) => void;
};

/** Returns whether the tab should be visible for the current state and channel. */
export type ChannelSettingsTabShouldRender = (state: GlobalState, channel: Channel) => boolean;

export type ChannelSettingsTab = {

    /** The plain string label shown for the tab in the UI. */
    uiName: string;

    /** The plugin component rendered in the channel settings content pane. */
    component: React.ComponentType<ChannelSettingsTabProps>;

    /** An optional icon string, such as a CSS class name or URL/path. */
    icon?: string;

    /** An optional synchronous visibility predicate for the tab. */
    shouldRender?: ChannelSettingsTabShouldRender;
};
