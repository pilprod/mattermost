// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createStore} from 'redux';

import pluginsReducer from 'reducers/plugins';

import {ActionTypes} from 'utils/constants';

import PluginRegistry from './registry';

// Replace the module-singleton store so registry.ts dispatches into our real reducer store.
// Jest hoists mock factories before module imports, so `mockGetStore` is used as an indirection:
// the factory closes over it, and tests reassign the underlying store instance per-test.
let mockCurrentStore: ReturnType<typeof createStore<ReturnType<typeof pluginsReducer>, any, any, any>>;

jest.mock('stores/redux_store', () => ({
    dispatch: (...args: any[]) => mockCurrentStore.dispatch(...args),
    getState: () => mockCurrentStore.getState(),
    subscribe: (...args: any[]) => mockCurrentStore.subscribe(...args),
}));

// Stub out side-effecting imports that registry.ts pulls in but aren't needed for this test.
jest.mock('mattermost-redux/store/reducer_registry', () => ({default: {register: jest.fn()}, register: jest.fn()}));
jest.mock('actions/admin_actions', () => ({
    registerAdminConsolePlugin: jest.fn(),
    unregisterAdminConsolePlugin: jest.fn(),
    registerAdminConsoleCustomSetting: jest.fn(),
    registerAdminConsoleCustomSection: jest.fn(),
}));
jest.mock('actions/views/rhs', () => ({
    showRHSPlugin: jest.fn(),
    hideRHSPlugin: jest.fn(),
    toggleRHSPlugin: jest.fn(),
}));
jest.mock('actions/views/root', () => ({
    registerPluginTranslationsSource: jest.fn(),
}));
jest.mock('actions/websocket_actions', () => ({
    registerPluginWebSocketEvent: jest.fn(),
    unregisterPluginWebSocketEvent: jest.fn(),
    registerPluginReconnectHandler: jest.fn(),
    unregisterPluginReconnectHandler: jest.fn(),
}));
jest.mock('utils/popouts/popout_windows', () => ({
    registerRHSPluginPopoutListener: jest.fn(),
}));

describe('PluginRegistry — registerChannelTypeOption reserved id rejection', () => {
    const PLUGIN_ID = 'test_plugin';

    beforeEach(() => {
        mockCurrentStore = createStore(pluginsReducer);
    });

    it('throws when registering with the reserved open-channel id', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        expect(() => {
            registry.registerChannelTypeOption({
                id: 'O',
                label: 'Bad Option',
                description: 'sub',
                icon: () => null,
                isAvailable: () => true,
                onCreate: async () => ({status: 'deferred'}),
            });
        }).toThrow(Error);
    });

    it('throws when registering with the reserved private-channel id', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        expect(() => {
            registry.registerChannelTypeOption({
                id: 'P',
                label: 'Bad Option',
                description: 'sub',
                icon: () => null,
                isAvailable: () => true,
                onCreate: async () => ({status: 'deferred'}),
            });
        }).toThrow(Error);
    });

    it('error message names the reserved ids', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        expect(() => {
            registry.registerChannelTypeOption({
                id: 'O',
                label: 'Bad Option',
                description: 'sub',
                icon: () => null,
                isAvailable: () => true,
                onCreate: async () => ({status: 'deferred'}),
            });
        }).toThrow(/['"]?O['"]?.*['"]?P['"]?|reserved/i);
    });
});

describe('PluginRegistry — registerChannelTypeOption', () => {
    const PLUGIN_ID = 'test_plugin';

    beforeEach(() => {
        mockCurrentStore = createStore(pluginsReducer);
    });

    function getOptions() {
        return mockCurrentStore.getState().components.ChannelTypeOption;
    }

    it('(a-d) registers an option and stores it in Redux state', () => {
        const registry = new PluginRegistry(PLUGIN_ID);

        registry.registerChannelTypeOption({
            id: 'test_option',
            label: 'Encrypted',
            description: 'sub',
            icon: () => null,
            isAvailable: () => true,
            onCreate: async () => ({status: 'deferred'}),
        });

        const options = getOptions();
        expect(options).toHaveLength(1);
        expect(options[0].id).toBe('test_option');
        expect(options[0].pluginId).toBe(PLUGIN_ID);
    });

    it('(e) re-registering same (pluginId, id) replaces the prior entry', () => {
        const registry = new PluginRegistry(PLUGIN_ID);

        const firstOnCreate = jest.fn();
        const firstIsAvailable = jest.fn();
        const secondOnCreate = jest.fn();
        const secondIsAvailable = jest.fn();

        registry.registerChannelTypeOption({
            id: 'test_option',
            label: 'Encrypted',
            description: 'sub',
            icon: () => null,
            isAvailable: firstIsAvailable,
            onCreate: firstOnCreate,
        });

        registry.registerChannelTypeOption({
            id: 'test_option',
            label: 'Updated label',
            description: 'sub',
            icon: () => null,
            isAvailable: secondIsAvailable,
            onCreate: secondOnCreate,
        });

        const options = getOptions();
        expect(options).toHaveLength(1);
        expect(options[0].label).toBe('Updated label');
        expect(options[0].onCreate).toBe(secondOnCreate);
        expect(options[0].isAvailable).toBe(secondIsAvailable);
    });

    it('(f) unregisterChannelTypeOption removes only that plugin option', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const otherRegistry = new PluginRegistry('other_plugin');

        registry.registerChannelTypeOption({
            id: 'test_option',
            label: 'Encrypted',
            description: 'sub',
            icon: () => null,
            isAvailable: () => true,
            onCreate: async () => ({status: 'deferred'}),
        });

        otherRegistry.registerChannelTypeOption({
            id: 'other_option',
            label: 'Other',
            description: 'other sub',
            icon: () => null,
            isAvailable: () => true,
            onCreate: async () => ({status: 'deferred'}),
        });

        registry.unregisterChannelTypeOption('test_option');

        const options = getOptions();
        expect(options).toHaveLength(1);
        expect(options[0].pluginId).toBe('other_plugin');
        expect(options[0].id).toBe('other_option');
    });

    it('(g) REMOVED_WEBAPP_PLUGIN removes all options for that plugin', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const otherRegistry = new PluginRegistry('other_plugin');

        registry.registerChannelTypeOption({
            id: 'option_1',
            label: 'A',
            description: 'd',
            icon: () => null,
            isAvailable: () => true,
            onCreate: async () => ({status: 'deferred'}),
        });

        registry.registerChannelTypeOption({
            id: 'option_2',
            label: 'B',
            description: 'd',
            icon: () => null,
            isAvailable: () => true,
            onCreate: async () => ({status: 'deferred'}),
        });

        otherRegistry.registerChannelTypeOption({
            id: 'other_option',
            label: 'C',
            description: 'd',
            icon: () => null,
            isAvailable: () => true,
            onCreate: async () => ({status: 'deferred'}),
        });

        mockCurrentStore.dispatch({
            type: ActionTypes.REMOVED_WEBAPP_PLUGIN,
            data: {id: PLUGIN_ID},
        });

        const options = getOptions();
        expect(options).toHaveLength(1);
        expect(options[0].pluginId).toBe('other_plugin');
    });
});

describe('PluginRegistry — registerChannelIconOverride', () => {
    const PLUGIN_ID = 'test_plugin';

    beforeEach(() => {
        mockCurrentStore = createStore(pluginsReducer);
    });

    function getOverrides() {
        return mockCurrentStore.getState().components.ChannelIconOverride;
    }

    it('(a) returns a string id', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const id = registry.registerChannelIconOverride({
            matcher: () => false,
            iconName: 'shield-outline',
        });
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });

    it('(b) reduced entry has pluginId, matcher, and iconName', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const matcher = () => false;
        registry.registerChannelIconOverride({matcher, iconName: 'shield-outline'});

        const overrides = getOverrides();
        expect(overrides).toHaveLength(1);
        expect(overrides[0].pluginId).toBe(PLUGIN_ID);
        expect(overrides[0].matcher).toBe(matcher);
        expect(overrides[0].iconName).toBe('shield-outline');
    });

    it('(c) re-registering produces a second entry with a different id', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const id1 = registry.registerChannelIconOverride({matcher: () => false, iconName: 'shield-outline'});
        const id2 = registry.registerChannelIconOverride({matcher: () => true, iconName: 'lock-outline'});

        expect(id1).not.toBe(id2);
        expect(getOverrides()).toHaveLength(2);
    });

    it('(d) unregisterChannelIconOverride removes only that entry', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const id1 = registry.registerChannelIconOverride({matcher: () => false, iconName: 'shield-outline'});
        const id2 = registry.registerChannelIconOverride({matcher: () => true, iconName: 'lock-outline'});

        registry.unregisterChannelIconOverride({id: id1});

        const overrides = getOverrides();
        expect(overrides).toHaveLength(1);
        expect(overrides[0].id).toBe(id2);
    });

    it('(e) REMOVED_WEBAPP_PLUGIN sweeps all overrides for that plugin', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const otherRegistry = new PluginRegistry('other_plugin');

        registry.registerChannelIconOverride({matcher: () => false, iconName: 'shield-outline'});
        registry.registerChannelIconOverride({matcher: () => false, iconName: 'lock-outline'});
        otherRegistry.registerChannelIconOverride({matcher: () => true, iconName: 'globe'});

        mockCurrentStore.dispatch({
            type: ActionTypes.REMOVED_WEBAPP_PLUGIN,
            data: {id: PLUGIN_ID},
        });

        const overrides = getOverrides();
        expect(overrides).toHaveLength(1);
        expect(overrides[0].pluginId).toBe('other_plugin');
    });

    it('(f) LOGOUT_SUCCESS resets the slot to []', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        registry.registerChannelIconOverride({matcher: () => false, iconName: 'shield-outline'});
        expect(getOverrides()).toHaveLength(1);

        mockCurrentStore.dispatch({type: 'LOGOUT_SUCCESS'});

        expect(getOverrides()).toHaveLength(0);
    });

    it('(g) two registrations from different plugins are sorted by pluginId', () => {
        const registryA = new PluginRegistry('aaa_plugin');
        const registryZ = new PluginRegistry('zzz_plugin');

        registryZ.registerChannelIconOverride({matcher: () => false, iconName: 'shield-outline'});
        registryA.registerChannelIconOverride({matcher: () => true, iconName: 'lock-outline'});

        const overrides = getOverrides();
        expect(overrides).toHaveLength(2);
        expect(overrides[0].pluginId).toBe('aaa_plugin');
        expect(overrides[1].pluginId).toBe('zzz_plugin');
    });

    it('(h) plugin B cannot unregister plugin A\'s override by id', () => {
        const registryA = new PluginRegistry('plugin_a');
        const registryB = new PluginRegistry('plugin_b');

        const idFromA = registryA.registerChannelIconOverride({matcher: () => true, iconName: 'shield-outline'});
        registryB.registerChannelIconOverride({matcher: () => false, iconName: 'lock-outline'});

        // Plugin B attempts to unregister plugin A's id — should be a no-op
        registryB.unregisterChannelIconOverride({id: idFromA});

        const overrides: Array<{pluginId: string}> = getOverrides();
        expect(overrides).toHaveLength(2);
        expect(overrides.some((o) => o.pluginId === 'plugin_a')).toBe(true);
    });

    it('(i) registering with an unknown iconName logs an error and does not add an entry', () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const registry = new PluginRegistry(PLUGIN_ID);

        registry.registerChannelIconOverride({
            matcher: () => false,
            iconName: 'not-a-real-icon' as any,
        });

        expect(getOverrides()).toHaveLength(0);
        expect(consoleSpy).toHaveBeenCalledTimes(1);
        expect(consoleSpy.mock.calls[0][0]).toContain('not-a-real-icon');
        consoleSpy.mockRestore();
    });

    it('(j) registering with a prototype-inherited key logs an error and does not add an entry', () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const registry = new PluginRegistry(PLUGIN_ID);

        registry.registerChannelIconOverride({
            matcher: () => false,
            iconName: 'constructor' as any,
        });

        expect(getOverrides()).toHaveLength(0);
        expect(consoleSpy).toHaveBeenCalledTimes(1);
        consoleSpy.mockRestore();
    });
});

describe('PluginRegistry — registerChannelDecorator', () => {
    const PLUGIN_ID = 'test_plugin';

    let store: ReturnType<typeof createStore<ReturnType<typeof pluginsReducer>, any, any, any>>;
    let registry: PluginRegistry;

    beforeEach(() => {
        store = createStore(pluginsReducer);
        mockCurrentStore = store;
        registry = new PluginRegistry(PLUGIN_ID);
    });

    function getDecorators() {
        return mockCurrentStore.getState().components.ChannelDecorator;
    }

    it('(a) valid registration adds entry to ChannelDecorator list', () => {
        registry.registerChannelDecorator({
            slot: 'left_of_channel_name',
            matcher: () => true,
            component: () => null,
        });

        const decorators = getDecorators();
        expect(decorators).toHaveLength(1);
        expect(decorators[0].pluginId).toBe(PLUGIN_ID);
        expect(decorators[0].slot).toBe('left_of_channel_name');
    });

    it('(b) invalid slot emits console.warn and does NOT add entry', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        registry.registerChannelDecorator({
            slot: 'bad_slot' as any,
            matcher: () => true,
            component: () => null,
        });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('bad_slot');
        expect(getDecorators()).toHaveLength(0);
        warnSpy.mockRestore();
    });

    it('(c) unregisterChannelDecorator removes only the matching entry', () => {
        const otherRegistry = new PluginRegistry('other_plugin');

        const id1 = registry.registerChannelDecorator({
            slot: 'left_of_channel_name',
            matcher: () => true,
            component: () => null,
        });

        otherRegistry.registerChannelDecorator({
            slot: 'left_of_channel_name',
            matcher: () => false,
            component: () => null,
        });

        registry.unregisterChannelDecorator({id: id1});

        const decorators = getDecorators();
        expect(decorators).toHaveLength(1);
        expect(decorators[0].pluginId).toBe('other_plugin');
    });

    it('(d) unregistering an unknown id is a no-op', () => {
        registry.registerChannelDecorator({
            slot: 'left_of_channel_name',
            matcher: () => true,
            component: () => null,
        });

        registry.unregisterChannelDecorator({id: 'nonexistent-id'});

        expect(getDecorators()).toHaveLength(1);
    });
});

describe('PluginRegistry — registerPostDecorator', () => {
    const PLUGIN_ID = 'test_plugin';

    let store: ReturnType<typeof createStore<ReturnType<typeof pluginsReducer>, any, any, any>>;
    let registry: PluginRegistry;

    beforeEach(() => {
        store = createStore(pluginsReducer);
        mockCurrentStore = store;
        registry = new PluginRegistry(PLUGIN_ID);
    });

    function getDecorators() {
        return mockCurrentStore.getState().components.PostDecorator;
    }

    it('(a) valid registration adds entry to PostDecorator list', () => {
        registry.registerPostDecorator({
            slot: 'post_header_badge',
            matcher: () => true,
            component: () => null,
        });

        const decorators = getDecorators();
        expect(decorators).toHaveLength(1);
        expect(decorators[0].pluginId).toBe(PLUGIN_ID);
        expect(decorators[0].slot).toBe('post_header_badge');
    });

    it('(b) invalid slot emits console.warn and does NOT add entry', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        registry.registerPostDecorator({
            slot: 'bad_slot' as any,
            matcher: () => true,
            component: () => null,
        });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('bad_slot');
        expect(getDecorators()).toHaveLength(0);
        warnSpy.mockRestore();
    });

    it('(c) unregisterPostDecorator removes only the matching entry', () => {
        const otherRegistry = new PluginRegistry('other_plugin');

        const id1 = registry.registerPostDecorator({
            slot: 'post_header_badge',
            matcher: () => true,
            component: () => null,
        });

        otherRegistry.registerPostDecorator({
            slot: 'post_header_badge',
            matcher: () => false,
            component: () => null,
        });

        registry.unregisterPostDecorator({id: id1});

        const decorators = getDecorators();
        expect(decorators).toHaveLength(1);
        expect(decorators[0].pluginId).toBe('other_plugin');
    });

    it('(d) unregistering an unknown id is a no-op', () => {
        registry.registerPostDecorator({
            slot: 'post_header_badge',
            matcher: () => true,
            component: () => null,
        });

        registry.unregisterPostDecorator({id: 'nonexistent-id'});

        expect(getDecorators()).toHaveLength(1);
    });
});

describe('PluginRegistry — registerComposerPlaceholderSuffix', () => {
    const PLUGIN_ID = 'test_plugin';

    beforeEach(() => {
        mockCurrentStore = createStore(pluginsReducer);
    });

    function getSuffixes() {
        return mockCurrentStore.getState().components.ComposerPlaceholderSuffix;
    }

    it('(a) dispatches RECEIVED_PLUGIN_COMPONENT with name ComposerPlaceholderSuffix', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const matcher = () => true;
        registry.registerComposerPlaceholderSuffix({matcher, text: ' (encrypted)'});

        const suffixes = getSuffixes();
        expect(suffixes).toHaveLength(1);
        expect(suffixes[0].pluginId).toBe(PLUGIN_ID);
        expect(suffixes[0].matcher).toBe(matcher);
        expect(suffixes[0].text).toBe(' (encrypted)');
    });

    it('(b) returns a non-empty string id', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const id = registry.registerComposerPlaceholderSuffix({matcher: () => false, text: ' (x)'});
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });

    it('(c) unregisterComposerPlaceholderSuffix dispatches REMOVED_PLUGIN_COMPONENT_BY_ID removing the entry', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const id = registry.registerComposerPlaceholderSuffix({matcher: () => true, text: ' (encrypted)'});
        expect(getSuffixes()).toHaveLength(1);

        registry.unregisterComposerPlaceholderSuffix({id});
        expect(getSuffixes()).toHaveLength(0);
    });

    it('(d) unregister is scoped to this plugin — other plugin entries survive', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const otherRegistry = new PluginRegistry('other_plugin');

        const id = registry.registerComposerPlaceholderSuffix({matcher: () => true, text: ' (a)'});
        otherRegistry.registerComposerPlaceholderSuffix({matcher: () => true, text: ' (b)'});

        registry.unregisterComposerPlaceholderSuffix({id});

        const suffixes = getSuffixes();
        expect(suffixes).toHaveLength(1);
        expect(suffixes[0].pluginId).toBe('other_plugin');
    });

    it('(e) two registrations from same plugin accumulate (no deduplication)', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const id1 = registry.registerComposerPlaceholderSuffix({matcher: () => true, text: ' (first)'});
        const id2 = registry.registerComposerPlaceholderSuffix({matcher: () => true, text: ' (second)'});

        expect(id1).not.toBe(id2);
        expect(getSuffixes()).toHaveLength(2);
        expect(getSuffixes()[0].text).toBe(' (first)');
        expect(getSuffixes()[1].text).toBe(' (second)');
    });

    it('(f) function text is stored as-is on the registration', () => {
        const registry = new PluginRegistry(PLUGIN_ID);
        const textFn = () => ' (dynamic)';
        registry.registerComposerPlaceholderSuffix({matcher: () => true, text: textFn});

        const suffixes = getSuffixes();
        expect(suffixes[0].text).toBe(textFn);
    });

    it('(g) two registrations from different plugins are sorted by pluginId', () => {
        const registryZ = new PluginRegistry('zzz_plugin');
        const registryA = new PluginRegistry('aaa_plugin');

        registryZ.registerComposerPlaceholderSuffix({matcher: () => true, text: ' (zzz)'});
        registryA.registerComposerPlaceholderSuffix({matcher: () => true, text: ' (aaa)'});

        const suffixes = getSuffixes();
        expect(suffixes).toHaveLength(2);
        expect(suffixes[0].pluginId).toBe('aaa_plugin');
        expect(suffixes[1].pluginId).toBe('zzz_plugin');
    });
});
