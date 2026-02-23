/**
 * tabs/registry - declarative tab registration
 *
 * Each tab module calls registerTab() to declare itself.
 * The Panel reads TAB_REGISTRY to build the tab bar and mount components.
 * To add a new tab: create a file, call registerTab(), done.
 */

import type { Component } from '@/components/Component';

export interface TabDefinition {
    id: string;
    label: string;
    create: () => Component;
    /** Called when this tab becomes the active tab */
    onActivate?: () => void;
}

export const TAB_REGISTRY: TabDefinition[] = [];

export function registerTab(def: TabDefinition): void {
    TAB_REGISTRY.push(def);
}
