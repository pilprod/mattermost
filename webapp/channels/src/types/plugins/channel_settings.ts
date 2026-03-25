// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type React from 'react';

import type {Channel} from '@mattermost/types/channels';

import type {GlobalState} from 'types/store';

export type ChannelSettingsTabSaveBarHandlers = {
    save: () => Promise<void>;
    reset: () => void;
};

export type ChannelSettingsTabProps = {

    /** The current channel being configured in the modal. */
    channel: Channel;

    /** Notifies the modal when this tab has unsaved changes. */
    setAreThereUnsavedChanges?: (unsaved: boolean) => void;

    /**
     * @deprecated The host modal shows SaveChangesPanel for plugin tabs; do not render tab-switch error UI.
     * This prop may be unset when the host owns the save bar.
     */
    showTabSwitchError?: boolean;

    /**
     * Registers save/discard handlers for the host-managed SaveChangesPanel (channel settings plugin tabs).
     * Call with `null` on unmount. Required when the tab may report unsaved changes.
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
