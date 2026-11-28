import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthProvidersManageScope,
  type EnvironmentId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { type FormEvent, useState } from "react";

import {
  useEnvironmentSettings,
  usePersistEnvironmentProviderInstanceMutation,
} from "../../hooks/useSettings";
import { m as resolveMessage } from "~/i18n/messages";
import { readEnvironmentScope } from "../../state/session";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { toastManager } from "../ui/toast";
import {
  type ApiService,
  apiServiceInstance,
  apiServiceInstanceId,
  isAllowedApiServiceUrl,
  searchApiServices,
} from "./apiServices";

const CUSTOM_ID = "custom";

export function ApiServiceDialog(props: {
  environmentId: EnvironmentId;
  environmentLabel: string;
  onClose: () => void;
}) {
  const gt = useGT();
  const settings = useEnvironmentSettings(props.environmentId);
  const persist = usePersistEnvironmentProviderInstanceMutation(props.environmentId);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ApiService | null>(null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  const isCustom = selected?.id === CUSTOM_ID;
  const ready =
    selected !== null &&
    selected.name.trim() !== "" &&
    isAllowedApiServiceUrl(selected.baseUrl) &&
    key.trim() !== "";

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || saving) return;
    if (!readEnvironmentScope(props.environmentId, AuthProvidersManageScope)) return;
    setSaving(true);
    const result = await persist({
      operation: "create",
      instanceId: ProviderInstanceId.make(
        apiServiceInstanceId(selected.id, new Set(Object.keys(settings.providerInstances ?? {}))),
      ),
      instance: apiServiceInstance({
        service: { ...selected, baseUrl: selected.baseUrl.trim() },
        key: key.trim(),
      }),
    });
    if (result._tag === "Failure") {
      setSaving(false);
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not add the API service"),
        description: thrownErrorMessage(error, resolveMessage) ?? gt("The settings update failed."),
      });
      return;
    }
    toastManager.add({ type: "success", title: gt("API service added") });
    props.onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{gt("Add an API service")}</DialogTitle>
          <DialogDescription>
            <T>
              Models run through OpenCode on <Var>{props.environmentLabel}</Var>. The key is stored
              on that server.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="api-service-form" className="grid gap-4" onSubmit={(event) => void save(event)}>
            {selected === null ? (
              <div className="grid gap-2">
                <Input
                  autoFocus
                  aria-label={gt("Search services")}
                  placeholder={gt("Search services")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <div className="grid max-h-64 gap-1 overflow-y-auto">
                  {searchApiServices(query).map((service) => (
                    <Button key={service.id} variant="ghost" onClick={() => setSelected(service)}>
                      {service.name}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    onClick={() => setSelected({ id: CUSTOM_ID, name: "", baseUrl: "" })}
                  >
                    <T>Other OpenAI-compatible service</T>
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {isCustom ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="api-service-name">
                      <T>Name</T>
                    </Label>
                    <Input
                      id="api-service-name"
                      value={selected.name}
                      onChange={(event) => setSelected({ ...selected, name: event.target.value })}
                    />
                  </div>
                ) : null}
                <div className="grid gap-1.5">
                  <Label htmlFor="api-service-url">
                    <T>The key is sent to</T>
                  </Label>
                  <Input
                    id="api-service-url"
                    readOnly={!isCustom}
                    placeholder="https://api.example.com/v1"
                    value={selected.baseUrl}
                    onChange={(event) => setSelected({ ...selected, baseUrl: event.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="api-service-key">
                    <T>API key</T>
                  </Label>
                  <Input
                    id="api-service-key"
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                  />
                </div>
              </>
            )}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => {
              if (selected === null) return props.onClose();
              setSelected(null);
              setKey("");
            }}
          >
            {selected === null ? <T>Cancel</T> : <T>Back</T>}
          </Button>
          <Button type="submit" form="api-service-form" disabled={!ready || saving}>
            <T>Add</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
