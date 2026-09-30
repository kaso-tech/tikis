import { ISO_COUNTRIES, countryDraftIssue, countryPlanWarning, isoCountry } from "../../../shared/iso-countries";
import { countryFlagEmoji } from "../../../lib/registration-rules";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAdminAuth } from "../lib/auth";
import { ConfirmDialog } from "../lib/confirm-dialog";

type Country = {
  id: string; name: string; dialCode: string; digits: number; groups: string; timeZones: string; enabled: boolean; sortOrder: number;
  accountCount: number; issue?: string | null; planWarning?: string | null;
};

type Draft = { id: string; name: string; digits: string; groups: string; timeZones: string; enabled: boolean };
type Editor = { mode: "create" | "edit"; draft: Draft };
type Pending = { kind: "delete" | "disable" | "enable"; country: Country };

const emptyDraft: Draft = { id: "", name: "", digits: "", groups: "", timeZones: "", enabled: true };

/** « 2,2,2,2 », « 2 2 2 2 » ou « 2-2-2-2 » : l'administrateur tape le découpage comme il le lit. */
function parseGroups(value: string) {
  return value.split(/[\s,;-]+/).filter(Boolean).map(Number);
}

function parseTimeZones(value: string) {
  return value.split(/[\s,;]+/).map((zone) => zone.trim()).filter(Boolean);
}

function isValidTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Numéro d'exemple tel que l'application l'affichera : « +226 70 12 34 56 ». */
function phoneExample(countryId: string, dialCode: string, groups: number[]) {
  const digits = groups.reduce((sum, size) => sum + size, 0);
  if (!digits || groups.some((size) => !Number.isInteger(size) || size <= 0)) return null;
  const sample = (isoCountry(countryId)?.allowsLeadingZero ? "0170123456789012" : "7012345678901234").slice(0, digits);
  let cursor = 0;
  const parts = groups.map((size) => { const part = sample.slice(cursor, cursor + size); cursor += size; return part; });
  return `${dialCode} ${parts.join(" ")}`;
}

function draftFromReference(id: string): Draft {
  const reference = isoCountry(id);
  if (!reference) return { ...emptyDraft, id };
  return {
    id,
    name: reference.name,
    digits: reference.digits ? String(reference.digits) : "",
    groups: reference.groups ? reference.groups.join(" ") : "",
    timeZones: reference.timeZones.join(", "),
    enabled: true,
  };
}

export default function CountriesPage() {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin";
  const [rows, setRows] = useState<Country[] | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    trpc.adminConsole.countries.list.query()
      .then((data) => setRows(data as Country[]))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."));
  }
  useEffect(load, []);

  const list = rows ?? [];
  const activeCount = list.filter((country) => country.enabled).length;
  const available = useMemo(
    () => ISO_COUNTRIES.filter((country) => !list.some((row) => row.id === country.id)).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [list],
  );

  function notify(message: string) {
    setError("");
    setSuccess(message);
  }

  function fail(cause: unknown, fallback: string) {
    setSuccess("");
    setError(cause instanceof Error ? cause.message : fallback);
  }

  function openCreate() {
    setEditorError("");
    setEditor({ mode: "create", draft: emptyDraft });
  }

  function openEdit(country: Country) {
    setEditorError("");
    setEditor({ mode: "edit", draft: { id: country.id, name: country.name, digits: String(country.digits), groups: country.groups.split(",").join(" "), timeZones: country.timeZones.split(",").join(", "), enabled: country.enabled } });
  }

  async function move(country: Country, offset: -1 | 1) {
    const index = list.findIndex((row) => row.id === country.id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setRows(next);
    try {
      await trpc.adminConsole.countries.reorder.mutate({ ids: next.map((row) => row.id) });
    } catch (cause) {
      fail(cause, "Réorganisation impossible.");
      load();
    }
  }

  async function runPending() {
    if (!pending) return;
    const { kind, country } = pending;
    // Suppression refusée d'avance (comptes inscrits) : la fenêtre propose de désactiver à la place.
    if (kind === "disable" && country.enabled && activeCount <= 1) { setPending(null); return; }
    if (kind === "delete" && country.accountCount > 0) {
      if (!country.enabled) { setPending(null); return; }
      setPending({ kind: "disable", country });
      return;
    }
    setBusy(true);
    try {
      if (kind === "delete") {
        await trpc.adminConsole.countries.remove.mutate({ id: country.id });
        notify(`${country.name} a été retiré de la liste.`);
      } else {
        await trpc.adminConsole.countries.setEnabled.mutate({ id: country.id, enabled: kind === "enable" });
        notify(kind === "enable" ? `${country.name} est de nouveau proposé dans l’application.` : `${country.name} n’est plus proposé dans l’application.`);
      }
      setPending(null);
      load();
    } catch (cause) {
      setPending(null);
      fail(cause, "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!editor) return;
    const { draft } = editor;
    const reference = isoCountry(draft.id);
    const groups = parseGroups(draft.groups);
    const timeZones = parseTimeZones(draft.timeZones);
    const digits = Number(draft.digits);
    if (!reference) { setEditorError("Choisissez un pays dans la liste."); return; }
    if (!draft.name.trim()) { setEditorError("Indiquez le nom affiché."); return; }
    const inconsistency = countryDraftIssue({ id: draft.id, name: draft.name, dialCode: reference.dialCode });
    if (inconsistency) { setEditorError(inconsistency); return; }
    if (!Number.isInteger(digits) || digits < 4 || digits > 15) { setEditorError("Le numéro national doit compter entre 4 et 15 chiffres."); return; }
    if (groups.length === 0 || groups.some((size) => !Number.isInteger(size) || size <= 0)) { setEditorError("Indiquez le découpage d’affichage, par exemple 2 2 2 2."); return; }
    if (groups.reduce((sum, size) => sum + size, 0) !== digits) { setEditorError(`Le découpage totalise ${groups.reduce((sum, size) => sum + size, 0)} chiffres au lieu de ${digits}.`); return; }
    if (timeZones.length === 0) { setEditorError("Indiquez au moins un fuseau horaire."); return; }
    const invalidZone = timeZones.find((zone) => !isValidTimeZone(zone));
    if (invalidZone) { setEditorError(`Fuseau horaire inconnu : ${invalidZone}.`); return; }
    setSaving(true);
    setEditorError("");
    try {
      await trpc.adminConsole.countries.upsert.mutate({ id: draft.id, name: draft.name.trim(), dialCode: reference.dialCode, digits, groups, timeZones, enabled: draft.enabled });
      notify(editor.mode === "create" ? `${draft.name.trim()} a été ajouté${draft.enabled ? " et est proposé dans l’application" : ", désactivé pour l’instant"}.` : `${draft.name.trim()} a été mis à jour.`);
      setEditor(null);
      load();
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const dialog = pending ? dialogFor(pending, activeCount) : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Pays</h1>
          <p className="page-sub">
            Pays proposés dans l’application, à l’inscription comme à la connexion, et format de leurs numéros
            {rows ? ` · ${list.length} pays, ${activeCount} actif${activeCount > 1 ? "s" : ""}` : ""}
          </p>
        </div>
        {canEdit ? (
          <div className="page-actions">
            <button className="btn btn-primary" disabled={!rows || available.length === 0} onClick={openCreate}>Ajouter un pays</button>
          </div>
        ) : null}
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

      <div className="card">
        {rows && list.length === 0 ? <div className="empty-state">Aucun pays configuré.</div> : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {canEdit ? <th style={{ width: 64 }}>Ordre</th> : null}
                  <th>Pays</th>
                  <th>Indicatif</th>
                  <th>Format des numéros</th>
                  <th>Fuseau horaire</th>
                  <th style={{ textAlign: "right" }}>Comptes</th>
                  <th>Statut</th>
                  {canEdit ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {list.map((country, index) => (
                  <tr key={country.id}>
                    {canEdit ? (
                      <td>
                        <div className="row-actions" style={{ justifyContent: "flex-start" }}>
                          <button className="btn btn-sm btn-ghost" aria-label={`Monter ${country.name}`} title="Monter" disabled={index === 0} onClick={() => void move(country, -1)}>↑</button>
                          <button className="btn btn-sm btn-ghost" aria-label={`Descendre ${country.name}`} title="Descendre" disabled={index === list.length - 1} onClick={() => void move(country, 1)}>↓</button>
                        </div>
                      </td>
                    ) : null}
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        <span aria-hidden="true">{countryFlagEmoji(country.id)}</span> {country.name} <span className="muted" style={{ fontWeight: 400 }}>{country.id}</span>
                      </div>
                      {country.issue ? <div className="field-error">⚠ {country.issue}</div> : null}
                      {country.planWarning ? <div className="field-warning">⚠ {country.planWarning}</div> : null}
                    </td>
                    <td className="phone-preview">{country.dialCode}</td>
                    <td>
                      <div className="phone-preview">{phoneExample(country.id, country.dialCode, country.groups.split(",").map(Number)) ?? "—"}</div>
                      <div className="muted text-sm">{country.digits} chiffres</div>
                    </td>
                    <td className="text-sm muted">{country.timeZones.split(",").join(", ")}</td>
                    <td className="price" style={{ textAlign: "right" }}>{country.accountCount.toLocaleString("fr-FR")}</td>
                    <td><span className={`pill ${country.enabled ? "pill-success" : ""}`}><span className="dot" />{country.enabled ? "Actif" : "Désactivé"}</span></td>
                    {canEdit ? (
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-sm" onClick={() => openEdit(country)}>Modifier</button>
                          <button className="btn btn-sm" onClick={() => setPending({ kind: country.enabled ? "disable" : "enable", country })}>{country.enabled ? "Désactiver" : "Activer"}</button>
                          <button className="btn btn-sm btn-danger-quiet" onClick={() => setPending({ kind: "delete", country })}>Supprimer</button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {canEdit && list.length > 1 ? <p className="muted text-sm" style={{ marginTop: 8 }}>L’ordre est celui de la liste des pays dans l’application.</p> : null}

      {editor ? (
        <CountryEditor
          editor={editor}
          available={available}
          saving={saving}
          error={editorError}
          onChange={(draft) => setEditor({ ...editor, draft })}
          onSave={() => void save()}
          onCancel={() => { if (!saving) setEditor(null); }}
        />
      ) : null}

      <ConfirmDialog
        open={!!pending}
        title={dialog?.title ?? ""}
        description={dialog?.body}
        confirmLabel={dialog?.confirm}
        cancelLabel={dialog?.cancel}
        tone={dialog?.tone}
        busy={busy}
        onConfirm={() => void runPending()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function accounts(count: number) {
  return `${count.toLocaleString("fr-FR")} compte${count > 1 ? "s" : ""}`;
}

function dialogFor({ kind, country }: Pending, activeCount: number): { title: string; body: React.ReactNode; confirm: string; cancel?: string; tone: "danger" | "primary" } {
  if (kind === "enable") {
    return {
      title: `Activer ${country.name} ?`,
      body: <p>Le pays sera de nouveau proposé dans l’application : inscription et connexion avec un numéro {country.dialCode}.</p>,
      confirm: "Activer",
      tone: "primary",
    };
  }
  if (kind === "disable" && country.enabled && activeCount <= 1) {
    return {
      title: `${country.name} est le dernier pays actif`,
      body: <p>L’application n’en proposerait plus aucun : personne ne pourrait s’inscrire ni se connecter. Activez d’abord un autre pays.</p>,
      confirm: "Compris",
      tone: "primary",
    };
  }
  if (kind === "disable") {
    return {
      title: `Désactiver ${country.name} ?`,
      body: <>
        <p>Le pays ne sera plus proposé dans l’application, ni à l’inscription ni à la connexion.</p>
        {country.accountCount > 0
          ? <p><strong>{accounts(country.accountCount)}</strong> inscrit{country.accountCount > 1 ? "s" : ""} avec un numéro {country.dialCode} ne pourr{country.accountCount > 1 ? "ont" : "a"} plus se connecter tant qu’il restera désactivé. Leurs données sont conservées.</p>
          : <p>Aucun compte n’y est inscrit.</p>}
      </>,
      confirm: "Désactiver",
      tone: "danger",
    };
  }
  if (country.accountCount > 0) {
    return {
      title: `Impossible de supprimer ${country.name}`,
      body: <>
        <p><strong>{accounts(country.accountCount)}</strong> y {country.accountCount > 1 ? "sont inscrits" : "est inscrit"}. Le supprimer les empêcherait de se connecter.</p>
        <p>{country.enabled ? "Vous pouvez le désactiver : il ne sera plus proposé dans l’application, et pourra être réactivé à tout moment." : "Le pays est déjà désactivé : il n’est plus proposé dans l’application."}</p>
      </>,
      confirm: country.enabled ? "Désactiver à la place" : "Compris",
      cancel: country.enabled ? "Annuler" : "Fermer",
      tone: country.enabled ? "danger" : "primary",
    };
  }
  return {
    title: `Supprimer ${country.name} ?`,
    body: <p>Le pays est retiré de la liste. Aucun compte n’y est inscrit. Vous pourrez l’ajouter de nouveau plus tard.</p>,
    confirm: "Supprimer",
    tone: "danger",
  };
}

function CountryEditor({ editor, available, saving, error, onChange, onSave, onCancel }: {
  editor: Editor;
  available: typeof ISO_COUNTRIES;
  saving: boolean;
  error: string;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { draft, mode } = editor;
  const reference = isoCountry(draft.id);
  const groups = parseGroups(draft.groups);
  const digits = Number(draft.digits) || 0;
  const total = groups.reduce((sum, size) => sum + (Number.isFinite(size) ? size : 0), 0);
  const example = reference ? phoneExample(draft.id, reference.dialCode, groups) : null;
  const planWarning = reference ? countryPlanWarning({ id: draft.id, name: draft.name, dialCode: reference.dialCode, digits: digits || undefined, groups }) : null;
  const unknownZones = parseTimeZones(draft.timeZones).filter((zone) => !isValidTimeZone(zone));
  const set = (changes: Partial<Draft>) => onChange({ ...draft, ...changes });

  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") onCancel(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="country-editor-title" onClick={(event) => event.stopPropagation()}>
        <h3 id="country-editor-title" className="modal-title">{mode === "create" ? "Ajouter un pays" : `Modifier ${draft.name}`}</h3>
        <p className="modal-body" style={{ marginBottom: 16 }}>
          {mode === "create"
            ? "Choisissez le pays : le code, l’indicatif, le format des numéros et le fuseau sont repris de la référence. Ajustez-les si le plan de numérotation a changé."
            : "Le code et l’indicatif sont fixes. Le format et le fuseau s’ajustent si le plan de numérotation change."}
        </p>

        {error ? <div className="banner-error">{error}</div> : null}

        <div className="form-grid">
          <div className="span-2">
            <label className="field-label" htmlFor="country-id">Pays</label>
            {mode === "create" ? (
              <select id="country-id" className="select" autoFocus value={draft.id} onChange={(event) => onChange(draftFromReference(event.target.value))}>
                <option value="">Choisir un pays…</option>
                {available.map((country) => (
                  <option key={country.id} value={country.id}>{countryFlagEmoji(country.id)} {country.name} ({country.dialCode})</option>
                ))}
              </select>
            ) : (
              <input id="country-id" className="input" disabled value={`${countryFlagEmoji(draft.id)} ${reference?.name ?? draft.id}`} />
            )}
          </div>

          {reference ? <>
            <div>
              <label className="field-label" htmlFor="country-code">Code ISO</label>
              <input id="country-code" className="input" disabled value={draft.id} />
            </div>
            <div>
              <label className="field-label" htmlFor="country-dial">Indicatif</label>
              <input id="country-dial" className="input" disabled value={reference.dialCode} />
            </div>

            <div className="span-2">
              <label className="field-label" htmlFor="country-name">Nom affiché</label>
              <input id="country-name" className="input" value={draft.name} maxLength={80} onChange={(event) => set({ name: event.target.value })} />
            </div>

            <div>
              <label className="field-label" htmlFor="country-digits">Chiffres du numéro national</label>
              <input id="country-digits" className="input" inputMode="numeric" value={draft.digits} onChange={(event) => set({ digits: event.target.value.replace(/[^0-9]/g, "").slice(0, 2) })} />
              {reference.digitsNote ? <div className="field-hint">{reference.digitsNote}</div> : null}
            </div>
            <div>
              <label className="field-label" htmlFor="country-groups">Découpage d’affichage</label>
              <input id="country-groups" className="input" placeholder="2 2 2 2" value={draft.groups} onChange={(event) => set({ groups: event.target.value })} />
              {groups.length > 0 && digits > 0 && total !== digits
                ? <div className="field-error">Le découpage totalise {total} chiffres au lieu de {digits}.</div>
                : <div className="field-hint">Taille de chaque bloc, séparée par des espaces.</div>}
            </div>

            <div className="span-2">
              <div className="action-block">
                <div className="action-block-title">Aperçu dans l’application</div>
                <div className="phone-preview" style={{ fontSize: 15 }}>{countryFlagEmoji(draft.id)} {example && total === digits ? example : "—"}</div>
              </div>
              {planWarning ? <div className="field-warning">⚠ {planWarning}</div> : null}
            </div>

            <div className="span-2">
              <label className="field-label" htmlFor="country-zones">Fuseau horaire</label>
              <input id="country-zones" className="input" placeholder="Africa/Ouagadougou" value={draft.timeZones} onChange={(event) => set({ timeZones: event.target.value })} />
              {unknownZones.length > 0
                ? <div className="field-error">Fuseau inconnu : {unknownZones.join(", ")}.</div>
                : <div className="field-hint">Sert à présélectionner le pays dans l’application. Plusieurs fuseaux : séparez-les par des virgules.</div>}
            </div>

            {mode === "create" ? (
              <label className="span-2" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={draft.enabled} onChange={(event) => set({ enabled: event.target.checked })} style={{ marginTop: 2 }} />
                <span>Proposer ce pays dans l’application dès maintenant<span className="field-hint" style={{ display: "block" }}>Décochez pour le préparer et l’activer plus tard.</span></span>
              </label>
            ) : null}
          </> : null}
        </div>

        <div className="modal-actions">
          <button className="btn" disabled={saving} onClick={onCancel}>Annuler</button>
          <button className="btn btn-primary" disabled={saving || !reference} onClick={onSave}>{saving ? "Enregistrement…" : mode === "create" ? "Ajouter le pays" : "Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}
