/**
 * Stand-in for `@raycast/api` under vitest.
 *
 * The real package is injected by the Raycast runtime and exposes no resolvable
 * Node entry point, so Vite cannot load it even in order to mock it.
 * `vitest.config.ts` aliases the package to this file.
 *
 * The components render plain DOM so tests can drive the real command code:
 * type into a field, click an action, assert what the command did. Two fidelity
 * details are deliberate, because commands depend on them:
 *
 * - `List` renders `List.EmptyView` only when it has no `List.Item` children,
 *   matching Raycast, which hides the empty view as soon as there are results.
 * - `Form.Dropdown` selects its first item by default, as Raycast does, so a
 *   dropdown with no items yields an empty value rather than a phantom one.
 *
 * Side-effecting APIs (`showToast`, `popToRoot`, ...) are `vi.fn()` mocks that
 * tests import straight from "@raycast/api" and assert against.
 */
import { Children, createContext, isValidElement, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { vi } from "vitest";

/* ------------------------------------------------------------------ effects */

export const showToast = vi.fn(async (options?: unknown) => options);
export const popToRoot = vi.fn(async () => undefined);
export const openExtensionPreferences = vi.fn(async () => undefined);
export const showHUD = vi.fn(async () => undefined);
export const getPreferenceValues = vi.fn(() => ({}) as never);

export const Toast = {
  Style: { Success: "success", Failure: "failure", Animated: "animated" },
};

export const LaunchType = { UserInitiated: "userInitiated", Background: "background" };

export const Icon = new Proxy({}, { get: (_t, name) => String(name) }) as Record<string, string>;
export const Color = new Proxy({}, { get: (_t, name) => String(name) }) as Record<string, string>;

// @raycast/utils' usePromise reads environment.launchType before reporting a
// failure, so it has to be present or every rejected promise becomes an
// unhandled error instead of reaching the component's error branch.
export const environment = {
  extensionName: "buzz",
  commandName: "test",
  isDevelopment: true,
  launchType: LaunchType.UserInitiated,
};

/* ------------------------------------------------------------- LocalStorage */

// An in-memory stand-in behind the real async API. `__resetLocalStorage` lets a
// test start from a clean slate without reaching into module internals.
const localStorageData = new Map<string, string>();

export const LocalStorage = {
  async getItem<T = string>(key: string): Promise<T | undefined> {
    return localStorageData.get(key) as T | undefined;
  },
  async setItem(key: string, value: string | number | boolean): Promise<void> {
    localStorageData.set(key, String(value));
  },
  async removeItem(key: string): Promise<void> {
    localStorageData.delete(key);
  },
  async clear(): Promise<void> {
    localStorageData.clear();
  },
};

export function __resetLocalStorage(): void {
  localStorageData.clear();
}

/* ------------------------------------------------------------- form plumbing */

type FormValues = Record<string, string>;

const FormContext = createContext<{
  values: FormValues;
  setValue: (id: string, value: string) => void;
} | null>(null);

function useFormContext() {
  return useContext(FormContext);
}

/* --------------------------------------------------------------------- List */

function ListItem(props: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  accessories?: unknown;
  icon?: unknown;
}) {
  return (
    <div data-testid="list-item" data-title={props.title} data-subtitle={props.subtitle}>
      {props.actions}
    </div>
  );
}

function ListEmptyView(props: { title?: string; description?: string; actions?: ReactNode }) {
  return (
    <div data-testid="empty-view" data-title={props.title} data-description={props.description}>
      {props.actions}
    </div>
  );
}

function ListSection(props: { title?: string; children?: ReactNode }) {
  return (
    <div data-testid="list-section" data-title={props.title}>
      {props.children}
    </div>
  );
}

export function List(props: {
  children?: ReactNode;
  isLoading?: boolean;
  navigationTitle?: string;
  searchBarPlaceholder?: string;
  onSearchTextChange?: (text: string) => void;
  throttle?: boolean;
}) {
  const items: ReactNode[] = [];
  const emptyViews: ReactNode[] = [];

  Children.forEach(props.children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === ListEmptyView) emptyViews.push(child);
    else items.push(child);
  });

  return (
    <div
      data-testid="list"
      data-loading={String(Boolean(props.isLoading))}
      data-navigation-title={props.navigationTitle}
    >
      <input
        data-testid="search-bar"
        placeholder={props.searchBarPlaceholder}
        onChange={(e) => props.onSearchTextChange?.(e.target.value)}
      />
      {/* Raycast hides the empty view as soon as there is at least one item. */}
      {items.length > 0 ? items : emptyViews}
    </div>
  );
}

List.Item = ListItem;
List.EmptyView = ListEmptyView;
List.Section = ListSection;

/* --------------------------------------------------------------------- Form */

function FormTextField(props: { id: string; title?: string; placeholder?: string; defaultValue?: string }) {
  const ctx = useFormContext();
  useEffect(() => {
    ctx?.setValue(props.id, props.defaultValue ?? "");
    // Registering the initial value once mirrors Raycast, where every declared
    // field is present in the submitted values even when untouched.
  }, []);
  return (
    <input
      data-testid={`field-${props.id}`}
      aria-label={props.title}
      placeholder={props.placeholder}
      defaultValue={props.defaultValue}
      onChange={(e) => ctx?.setValue(props.id, e.target.value)}
    />
  );
}

function FormTextArea(props: { id: string; title?: string; placeholder?: string; defaultValue?: string }) {
  const ctx = useFormContext();
  useEffect(() => {
    ctx?.setValue(props.id, props.defaultValue ?? "");
  }, []);
  return (
    <textarea
      data-testid={`field-${props.id}`}
      aria-label={props.title}
      placeholder={props.placeholder}
      onChange={(e) => ctx?.setValue(props.id, e.target.value)}
    />
  );
}

function FormDropdownItem(props: { value: string; title?: string }) {
  return <option value={props.value}>{props.title}</option>;
}

function FormDropdown(props: { id: string; title?: string; children?: ReactNode; defaultValue?: string }) {
  const ctx = useFormContext();
  const values: string[] = [];
  Children.forEach(props.children, (child) => {
    if (isValidElement<{ value: string }>(child)) values.push(child.props.value);
  });
  const first = values[0] ?? "";
  // Honour an explicit defaultValue when it names a real item, matching Raycast;
  // otherwise fall back to preselecting the first item, as before.
  const selected = props.defaultValue !== undefined && values.includes(props.defaultValue) ? props.defaultValue : first;

  useEffect(() => {
    ctx?.setValue(props.id, selected);
  }, [selected]);

  return (
    <select
      data-testid={`field-${props.id}`}
      aria-label={props.title}
      defaultValue={selected}
      onChange={(e) => ctx?.setValue(props.id, e.target.value)}
    >
      {props.children}
    </select>
  );
}

FormDropdown.Item = FormDropdownItem;

export function Form(props: { children?: ReactNode; actions?: ReactNode; isLoading?: boolean }) {
  const [values, setValues] = useState<FormValues>({});
  const setValue = (id: string, value: string) => setValues((prev) => ({ ...prev, [id]: value }));

  return (
    <FormContext.Provider value={{ values, setValue }}>
      <div data-testid="form" data-loading={String(Boolean(props.isLoading))}>
        {props.children}
        {props.actions}
      </div>
    </FormContext.Provider>
  );
}

Form.TextField = FormTextField;
Form.TextArea = FormTextArea;
Form.Dropdown = FormDropdown;
Form.Description = (props: { text?: string }) => <p data-testid="form-description">{props.text}</p>;
Form.Separator = () => <hr data-testid="form-separator" />;

/* ------------------------------------------------------------------ Actions */

export function ActionPanel(props: { children?: ReactNode; title?: string }) {
  return <div data-testid="action-panel">{props.children}</div>;
}

ActionPanel.Section = (props: { children?: ReactNode; title?: string }) => (
  <div data-testid="action-panel-section">{props.children}</div>
);

export function Action(props: { title: string; onAction?: () => void; icon?: unknown; shortcut?: unknown }) {
  return (
    <button data-testid="action" data-title={props.title} onClick={() => props.onAction?.()}>
      {props.title}
    </button>
  );
}

function ActionPush(props: { title: string; target: ReactNode; icon?: unknown }) {
  const [pushed, setPushed] = useState(false);
  if (pushed) return <div data-testid="pushed-view">{props.target}</div>;
  return (
    <button data-testid="action" data-title={props.title} data-kind="push" onClick={() => setPushed(true)}>
      {props.title}
    </button>
  );
}

function ActionCopyToClipboard(props: { title: string; content: string; shortcut?: unknown }) {
  return (
    <button data-testid="action" data-title={props.title} data-kind="copy" data-content={props.content}>
      {props.title}
    </button>
  );
}

function ActionSubmitForm(props: { title: string; onSubmit: (values: FormValues) => void; icon?: unknown }) {
  const ctx = useFormContext();
  return (
    <button
      data-testid="submit"
      data-title={props.title}
      data-kind="submit"
      onClick={() => props.onSubmit(ctx?.values ?? {})}
    >
      {props.title}
    </button>
  );
}

Action.Push = ActionPush;
Action.CopyToClipboard = ActionCopyToClipboard;
Action.SubmitForm = ActionSubmitForm;
Action.OpenInBrowser = (props: { title?: string; url: string }) => (
  <button data-testid="action" data-title={props.title} data-kind="open-in-browser" data-url={props.url} />
);
