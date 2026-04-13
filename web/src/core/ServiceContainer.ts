/**
 * ServiceContainer — Dependency Injection Container
 *
 * Replaces window.__axia_* globals with explicit service registration.
 * Enables:
 * - Type-safe service access
 * - Easy testing (mock services)
 * - No memory leaks (services can be unregistered)
 * - Clear dependency graph
 *
 * Usage:
 *   container.register('bridge', bridge);
 *   const b = container.get<WasmBridge>('bridge');
 *   if (container.has('viewport')) { ... }
 */

import { debugLog } from '../utils/debug';

export class ServiceContainer {
  private services: Map<string, any> = new Map();
  private frozen: boolean = false;

  /**
   * Register a service instance in the container.
   * @param key - Unique service identifier (e.g., 'bridge', 'viewport')
   * @param instance - Service instance to register
   * @throws Error if container is frozen or key already registered
   */
  register<T>(key: string, instance: T): void {
    if (this.frozen) {
      throw new Error(
        `[ServiceContainer] Cannot register '${key}': container is frozen`
      );
    }

    if (this.services.has(key)) {
      console.warn(
        `[ServiceContainer] Overwriting service '${key}' (previous instance will be GC'd)`
      );
    }

    this.services.set(key, instance);
    debugLog(`[ServiceContainer] Registered service: ${key}`);
  }

  /**
   * Get a registered service by key.
   * @param key - Service identifier
   * @returns Service instance
   * @throws Error if service not found
   */
  get<T>(key: string): T {
    if (!this.services.has(key)) {
      const available = Array.from(this.services.keys()).join(', ');
      throw new Error(
        `[ServiceContainer] Service not found: '${key}'\nAvailable: ${available || '(none)'}`
      );
    }
    return this.services.get(key) as T;
  }

  /**
   * Check if a service is registered.
   * @param key - Service identifier
   * @returns true if service exists
   */
  has(key: string): boolean {
    return this.services.has(key);
  }

  /**
   * Get a service or undefined (safe access).
   * @param key - Service identifier
   * @returns Service instance or undefined
   */
  tryGet<T>(key: string): T | undefined {
    return (this.services.get(key) as T) ?? undefined;
  }

  /**
   * Freeze the container (prevent further registrations).
   * Useful after initialization to catch accidental registration attempts.
   */
  freeze(): void {
    this.frozen = true;
    debugLog('[ServiceContainer] Container frozen - no more registrations allowed');
  }

  /**
   * Unfreeze the container (allow registrations again).
   * Only use for testing/teardown.
   */
  unfreeze(): void {
    this.frozen = false;
  }

  /**
   * Unregister a service (for cleanup/testing).
   * @param key - Service identifier
   */
  unregister(key: string): void {
    if (this.services.has(key)) {
      this.services.delete(key);
      debugLog(`[ServiceContainer] Unregistered service: ${key}`);
    }
  }

  /**
   * Clear all services (for testing/reset).
   */
  clear(): void {
    const count = this.services.size;
    this.services.clear();
    debugLog(`[ServiceContainer] Cleared ${count} service(s)`);
  }

  /**
   * Get all registered service keys (for debugging).
   * @returns Array of service keys
   */
  keys(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get count of registered services.
   * @returns Number of services
   */
  size(): number {
    return this.services.size;
  }

  /**
   * Print debug info about registered services.
   */
  debug(): void {
    debugLog('[ServiceContainer] Registered services:');
    for (const [key, service] of this.services) {
      const type = service?.constructor?.name ?? typeof service;
      debugLog(`  ${key}: ${type}`);
    }
  }
}

/**
 * Global singleton ServiceContainer instance.
 * Initialize this once in main.ts, then inject services.
 *
 * Example:
 *   const container = new ServiceContainer();
 *   container.register('bridge', bridge);
 *   container.register('viewport', viewport);
 *   window.__axia = container;  // Single global
 *   container.freeze();  // Prevent accidental registrations
 */
export const serviceContainer = new ServiceContainer();

/**
 * Type-safe service registry (documentation purpose).
 *
 * All registered services and their types:
 *   - 'bridge': WasmBridge
 *   - 'viewport': Viewport
 *   - 'toolManager': ToolManager
 *   - 'units': UnitSystem
 *   - 'panelManager': DraggablePanelManager
 *   - 'fileManager': FileManager
 *   - 'materialLibrary': MaterialLibrary
 *   - 'fileImporter': FileImporter
 *   - 'commandInput': CommandInput
 */
export interface ServiceRegistry {
  bridge?: any; // WasmBridge
  viewport?: any; // Viewport
  toolManager?: any; // ToolManager
  units?: any; // UnitSystem
  panelManager?: any; // DraggablePanelManager
  fileManager?: any; // FileManager
  materialLibrary?: any; // MaterialLibrary
  fileImporter?: any; // FileImporter
  commandInput?: any; // CommandInput
}
