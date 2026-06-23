import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Button, SelectField } from "@/components/UI";
import { useRun } from "@/context/RunContext";
import SubstitutionsManager from "@/components/SubstitutionsManager";
import SubstitutionLog from "@/components/SubstitutionLog";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import {
  type CandidateItem,
  type InventoryItem,
  type InventoryLot,
  type InventoryLocation,
  type LedgerEntry,
  type TransferNeed,
  fetchInventory,
  fetchInventoryLocations,
  createInventoryLocation,
  updateInventoryLocation,
  deleteInventoryLocation,
  transferInventory,
  computeRunTransferNeeds,
  fetchLedger,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  restockInventory,
  adjustInventory,
  fetchInventorySettings,
  updateInventorySettings,
  identifyInventoryPhoto,
  MAX_IMAGE_BASE64_CHARS,
  photoErrorMessage,
  InventoryApiError,
  rankCandidatesByName,
  fetchPhotoAliases,
  savePhotoAliases,
  applyPhotoAliases,
  type PhotoAlias,
  deriveCandidateItems,
  isLowStock,
  lotExpiryStatus,
  daysUntil,
  todayStr,
  openInventoryStream,
  EXPIRY_SOON_DAYS,
  type InventoryCategory,
  type PhotoGuess,
  qualityCheckPhoto,
  recordQualityCheck,
  wasteInsight,
  type QualityProductType,
  type QualityStatus,
  type QualityCheckResult,
  type WasteInsightResult,
} from "@/context/inventoryShared";
import { getOrCreateClientId } from "@/context/sync/client";
import { useMe } from "@/hooks/useRole";
import ProactiveAlertSettingsCard from "@/components/ProactiveAlertSettingsCard";
import { saveFacilityKnowledge } from "@/context/aiMemory";

function fmtQty(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function InventoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    allRuns,
    substitutions,
    substitutionLog,
    addSubstitution,
    removeSubstitution,
    clearSubstitutions,
  } = useRun();
  const { hasCapability } = useMe();
  const canManageInventory = hasCapability("manage-inventory");
  const canUseAiTools = hasCapability("use-ai-tools");

  const webTop = Platform.OS === "web" ? 67 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [expirySoonDays, setExpirySoonDays] = useState<number>(EXPIRY_SOON_DAYS);
  const [expiryInput, setExpiryInput] = useState<string>(String(EXPIRY_SOON_DAYS));
  const refetchRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    try {
      const [data, settings, locs] = await Promise.all([
        fetchInventory(),
        fetchInventorySettings(),
        fetchInventoryLocations(),
      ]);
      setItems(data);
      setLocations(locs);
      setExpirySoonDays(settings.expirySoonDays);
      setExpiryInput(String(settings.expirySoonDays));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, []);
  refetchRef.current = load;

  const saveExpiryLeadTime = useCallback(async () => {
    const n = Math.max(0, Math.round(Number(expiryInput)));
    if (!Number.isFinite(n) || n === expirySoonDays) {
      setExpiryInput(String(expirySoonDays));
      return;
    }
    try {
      const saved = await updateInventorySettings({ expirySoonDays: n });
      setExpirySoonDays(saved.expirySoonDays);
      setExpiryInput(String(saved.expirySoonDays));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
      setExpiryInput(String(expirySoonDays));
    }
  }, [expiryInput, expirySoonDays]);

  useEffect(() => {
    let stream: { close: () => void } | null = null;
    let cancelled = false;
    load();
    (async () => {
      const clientId = await getOrCreateClientId();
      if (cancelled) return;
      stream = openInventoryStream(clientId, (senderId) => {
        if (senderId !== clientId) refetchRef.current();
      });
    })();
    return () => {
      cancelled = true;
      stream?.close();
    };
  }, [load]);

  const candidates = useMemo(
    () => deriveCandidateItems(allRuns.map((r) => r.settings)),
    [allRuns],
  );

  // Transfer warnings: roll today's runs up into total demand and compare
  // against per-location stock. Mirrors the web app exactly (same shared math).
  const transferNeeds = useMemo<TransferNeed[]>(
    () => computeRunTransferNeeds(allRuns.map((r) => r.settings), items),
    [allRuns, items],
  );

  const [subPrefill, setSubPrefill] = useState<string | null>(null);

  // Options for the substitution pickers: consumption-key names (cheese/pep
  // types, Dough, Sauce, packaging) plus every recipe-row ingredient and
  // non-empty type value across today's runs. Mirrors web's optSet. Free text
  // is still allowed via the picker's add row.
  const substitutionOptions = useMemo(() => {
    const set = new Set<string>(candidates.map((c) => c.name));
    for (const r of allRuns) {
      const s = r.settings;
      const recipes = [
        s.doughRecipe,
        s.frontlineRecipe,
        s.app1CheeseRecipe,
        s.app2CheeseRecipe,
        s.app3CheeseRecipe,
        s.app4CheeseRecipe,
      ];
      for (const rows of recipes)
        for (const row of rows ?? []) if (row?.ingredient) set.add(row.ingredient);
      for (const t of [s.app1Type, s.app2Type, s.app3Type, s.app4Type, s.pep1Type, s.pep2Type])
        if (t) set.add(t);
    }
    return [...set].sort();
  }, [candidates, allRuns]);

  const alerts = useMemo(() => {
    const low: InventoryItem[] = [];
    const expiring: { item: InventoryItem; lot: InventoryLot }[] = [];
    const expired: { item: InventoryItem; lot: InventoryLot }[] = [];
    for (const it of items) {
      if (isLowStock(it)) low.push(it);
      for (const lot of it.lots) {
        if (lot.qtyRemaining <= 0) continue;
        const st = lotExpiryStatus(lot, expirySoonDays);
        if (st === "expired") expired.push({ item: it, lot });
        else if (st === "soon") expiring.push({ item: it, lot });
      }
    }
    return { low, expiring, expired };
  }, [items, expirySoonDays]);

  const grouped = useMemo(() => {
    const packaging = items.filter((i) => i.category === "packaging");
    const ingredient = items.filter((i) => i.category !== "packaging");
    return { packaging, ingredient };
  }, [items]);

  const existingKeys = useMemo(() => new Set(items.map((i) => i.key)), [items]);

  // Merged candidate set for photo matching: existing tracked items + items the
  // current production plan would consume. Deduped by stable key.
  const matchCandidates = useMemo<CandidateItem[]>(() => {
    const map = new Map<string, CandidateItem>();
    for (const it of items) {
      map.set(it.key, {
        key: it.key,
        category: (it.category === "packaging" ? "packaging" : "ingredient") as InventoryCategory,
        name: it.name,
        unit: it.unit,
      });
    }
    for (const c of candidates) if (!map.has(c.key)) map.set(c.key, c);
    return [...map.values()];
  }, [items, candidates]);

  const hasAlerts =
    alerts.expired.length > 0 || alerts.expiring.length > 0 || alerts.low.length > 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: webTop + 8, paddingBottom: 90 + webBottom + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Alerts */}
        {hasAlerts && (
          <Card title="Inventory Alerts" icon="alert-triangle" accentColor={colors.warning} style={{ marginBottom: 16 }}>
            <View style={{ gap: 6 }}>
              {alerts.expired.map(({ item, lot }) => (
                <View key={`exp-${lot.id}`} style={styles.alertRow}>
                  <Text style={[styles.alertText, { color: colors.destructive }]} numberOfLines={1}>
                    {item.name}{lot.lotNumber ? ` · lot ${lot.lotNumber}` : ""}
                  </Text>
                  <Text style={[styles.alertValue, { color: colors.destructive }]} numberOfLines={1}>
                    Expired {lot.expirationDate}
                  </Text>
                </View>
              ))}
              {alerts.expiring.map(({ item, lot }) => (
                <View key={`soon-${lot.id}`} style={styles.alertRow}>
                  <Text style={[styles.alertText, { color: colors.warning }]} numberOfLines={1}>
                    {item.name}{lot.lotNumber ? ` · lot ${lot.lotNumber}` : ""}
                  </Text>
                  <Text style={[styles.alertValue, { color: colors.warning }]} numberOfLines={1}>
                    Expires in {daysUntil(lot.expirationDate)}d
                  </Text>
                </View>
              ))}
              {alerts.low.map((item) => (
                <View key={`low-${item.id}`} style={styles.alertRow}>
                  <Pressable
                    onPress={() => setSubPrefill(item.name)}
                    hitSlop={6}
                    style={styles.subPrefillBtn}
                  >
                    <Feather name="repeat" size={12} color={colors.warning} />
                    <Text style={[styles.subPrefillText, { color: colors.warning }]} numberOfLines={1}>
                      {item.name} — low stock
                    </Text>
                  </Pressable>
                  <Text style={[styles.alertValue, { color: colors.warning }]} numberOfLines={1}>
                    {fmtQty(item.onHand)} / {fmtQty(item.reorderThreshold)} {item.unit}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        )}

        {/* Transfer warnings: onsite/line can't cover the day's plan but another
            location holds stock that could be moved in. */}
        {transferNeeds.length > 0 && (
          <Card title="Transfer Needed" icon="repeat" accentColor={colors.primary} style={{ marginBottom: 16 }}>
            <View style={{ gap: 8 }}>
              {transferNeeds.map((t) => (
                <View key={`xfer-${t.key}`} style={styles.alertRow}>
                  <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                    <Text style={[styles.alertText, { color: colors.primary }]} numberOfLines={1}>
                      {t.name}
                    </Text>
                    <Text style={[styles.tinyMuted, { color: colors.mutedForeground }]}>
                      Need {fmtQty(t.needed)} {t.unit}, onsite has {fmtQty(t.onsite)}. Move{" "}
                      {fmtQty(t.transferable)} {t.unit} from{" "}
                      {t.sources.map((s) => s.locationName).join(", ")}.
                    </Text>
                  </View>
                  <Text style={[styles.alertValue, { color: colors.primary }]} numberOfLines={1}>
                    −{fmtQty(t.shortfall)} {t.unit}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        )}

        {/* Locations (named storage). Managers add/rename/set-onsite/delete. */}
        {canManageInventory && (
          <LocationsCard locations={locations} onChanged={load} />
        )}

        {/* Temporary substitutions overlay (day-state, reverts at daily reset) */}
        <SubstitutionsManager
          substitutions={substitutions}
          ingredientOptions={substitutionOptions}
          onAdd={addSubstitution}
          onRemove={removeSubstitution}
          onClearAll={clearSubstitutions}
          prefillIngredient={subPrefill}
          onPrefillConsumed={() => setSubPrefill(null)}
        />

        {/* Read-only activity log of today's substitution adds/clears */}
        <SubstitutionLog entries={substitutionLog} />

        {/* Add item (manage-inventory: inventory-item master-data write) */}
        {canManageInventory && (
          <Card title="Add Item" icon="plus-square" style={{ marginBottom: 16 }}>
            <Pressable
              onPress={() => setShowAdd((v) => !v)}
              style={({ pressed }) => [
                styles.toggleBtn,
                { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name={showAdd ? "chevron-down" : "plus"} size={14} color={colors.mutedForeground} />
              <Text style={[styles.toggleBtnText, { color: colors.mutedForeground }]}>
                {showAdd ? "Close" : "New"}
              </Text>
            </Pressable>
            {showAdd && (
              <View style={{ marginTop: 12 }}>
                <AddItemForm
                  candidates={candidates.filter((c) => !existingKeys.has(c.key))}
                  onAdded={() => {
                    setShowAdd(false);
                    load();
                  }}
                />
              </View>
            )}
          </Card>
        )}

        {/* Photo stock intake (use-ai-tools: paid AI action) */}
        {canUseAiTools && <PhotoIntakeCard candidates={matchCandidates} locations={locations} onCommitted={load} />}

        {/* AI quality/defect photo check (use-ai-tools: paid AI action) */}
        {canUseAiTools && <QualityCheckCard />}

        {/* AI expiry & waste insight (use-ai-tools: paid AI action) */}
        {canUseAiTools && <WasteInsightCard />}

        {loading && (
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading inventory…</Text>
        )}
        {error && <Text style={[styles.muted, { color: colors.destructive }]}>{error}</Text>}
        {!loading && items.length === 0 && (
          <Text style={[styles.emptyCenter, { color: colors.mutedForeground }]}>
            No inventory yet. Use Add Item to start tracking stock.
          </Text>
        )}

        {grouped.packaging.length > 0 && (
          <CategorySection
            title="Packaging"
            icon="package"
            items={grouped.packaging}
            locations={locations}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            onChanged={load}
            expirySoonDays={expirySoonDays}
          />
        )}
        {grouped.ingredient.length > 0 && (
          <CategorySection
            title="Ingredients"
            icon="box"
            items={grouped.ingredient}
            locations={locations}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            onChanged={load}
            expirySoonDays={expirySoonDays}
          />
        )}

        {/* Settings: configurable expiry lead time (manage-inventory) */}
        {canManageInventory && (
          <Card title="Settings" icon="settings" style={{ marginBottom: 16 }}>
            <View style={styles.settingsRow}>
              <Text style={[styles.settingsLabel, { color: colors.mutedForeground }]}>
                Expiring-soon lead time (days)
              </Text>
              <TextInput
                style={[
                  styles.settingsInput,
                  { borderColor: colors.border, color: colors.foreground },
                ]}
                keyboardType="number-pad"
                value={expiryInput}
                onChangeText={setExpiryInput}
                onBlur={saveExpiryLeadTime}
                returnKeyType="done"
                onSubmitEditing={saveExpiryLeadTime}
              />
            </View>
            <Text style={[styles.settingsHint, { color: colors.mutedForeground }]}>
              Lots within this many days of expiring are flagged as expiring soon.
            </Text>
          </Card>
        )}

        {/* Proactive-alert tuning (use-ai-tools: AI nudge settings) */}
        {canUseAiTools && <ProactiveAlertSettingsCard />}

      </ScrollView>
    </View>
  );
}

function CategorySection({
  title,
  icon,
  items,
  locations,
  expandedId,
  setExpandedId,
  onChanged,
  expirySoonDays,
}: {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  items: InventoryItem[];
  locations: InventoryLocation[];
  expandedId: number | null;
  setExpandedId: (id: number | null) => void;
  onChanged: () => void;
  expirySoonDays: number;
}) {
  return (
    <Card title={title} icon={icon} style={{ marginBottom: 16 }} contentStyle={{ gap: 6 }}>
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          locations={locations}
          expanded={expandedId === item.id}
          onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
          onChanged={onChanged}
          expirySoonDays={expirySoonDays}
        />
      ))}
    </Card>
  );
}

function ItemRow({
  item,
  locations,
  expanded,
  onToggle,
  onChanged,
  expirySoonDays,
}: {
  item: InventoryItem;
  locations: InventoryLocation[];
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  expirySoonDays: number;
}) {
  const colors = useColors();
  const low = isLowStock(item);
  return (
    <View style={[styles.itemRow, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
      <Pressable onPress={onToggle} style={styles.itemHeader}>
        <View style={styles.itemHeaderLeft}>
          <Feather
            name={expanded ? "chevron-down" : "chevron-right"}
            size={16}
            color={colors.mutedForeground}
          />
          <Text style={[styles.itemName, { color: colors.foreground }]} numberOfLines={1}>
            {item.name}
          </Text>
          {low && (
            <View style={[styles.lowBadge, { borderColor: colors.warning }]}>
              <Text style={[styles.lowBadgeText, { color: colors.warning }]}>LOW</Text>
            </View>
          )}
        </View>
        <Text
          style={[
            styles.itemQty,
            { color: low ? colors.warning : colors.foreground },
          ]}
          numberOfLines={1}
        >
          {fmtQty(item.onHand)}{" "}
          <Text style={[styles.itemUnit, { color: colors.mutedForeground }]}>{item.unit}</Text>
        </Text>
      </Pressable>
      {expanded && <ItemDetail item={item} locations={locations} onChanged={onChanged} expirySoonDays={expirySoonDays} />}
    </View>
  );
}

function ItemDetail({ item, locations, onChanged, expirySoonDays }: { item: InventoryItem; locations: InventoryLocation[]; onChanged: () => void; expirySoonDays: number }) {
  const colors = useColors();
  const { hasCapability } = useMe();
  const canManageInventory = hasCapability("manage-inventory");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<LedgerEntry[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [editThreshold, setEditThreshold] = useState(false);
  const [thresholdVal, setThresholdVal] = useState(String(item.reorderThreshold));

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
        onChanged();
      } catch {
        /* surfaced by parent reload */
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  async function loadHistory() {
    if (!showHistory && history == null) {
      try {
        setHistory(await fetchLedger(item.id));
      } catch {
        setHistory([]);
      }
    }
    setShowHistory((v) => !v);
  }

  const lots = item.lots.filter((l) => l.qtyRemaining > 0);
  const emptyLots = item.lots.filter((l) => l.qtyRemaining <= 0);

  function expiryColor(st: ReturnType<typeof lotExpiryStatus>): string {
    if (st === "expired") return colors.destructive;
    if (st === "soon") return colors.warning;
    return colors.mutedForeground;
  }

  return (
    <View style={[styles.detail, { borderTopColor: colors.border }]}>
      {/* Lots */}
      <View>
        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
          LOTS (FIFO/FEFO ORDER)
        </Text>
        {lots.length === 0 ? (
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>No stock on hand.</Text>
        ) : (
          <View style={{ gap: 4 }}>
            {lots.map((lot) => {
              const st = lotExpiryStatus(lot, expirySoonDays);
              return (
                <View key={lot.id} style={styles.lotRow}>
                  <Text style={[styles.lotText, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {lot.lotNumber ? `Lot ${lot.lotNumber}` : "Unlotted"}
                    {lot.expirationDate ? (
                      <Text style={{ color: expiryColor(st) }}> · exp {lot.expirationDate}</Text>
                    ) : null}
                  </Text>
                  <Text style={[styles.lotQty, { color: colors.foreground }]} numberOfLines={1}>
                    {fmtQty(lot.qtyRemaining)} / {fmtQty(lot.qtyReceived)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
        {emptyLots.length > 0 && (
          <Text style={[styles.tinyMuted, { color: colors.mutedForeground }]}>
            {emptyLots.length} depleted lot{emptyLots.length !== 1 ? "s" : ""}
          </Text>
        )}
      </View>

      {/* Per-location on-hand. Only shown once stock lives in more than the
          single onsite location (otherwise the headline on-hand already says
          everything). */}
      {item.byLocation.length > 1 && (
        <View>
          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>BY LOCATION</Text>
          <View style={{ gap: 4 }}>
            {item.byLocation.map((loc) => (
              <View key={loc.locationId} style={styles.lotRow}>
                <Text style={[styles.lotText, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {loc.locationName}
                  {loc.isOnsite ? (
                    <Text style={{ color: colors.success ?? colors.primary }}> · onsite</Text>
                  ) : null}
                </Text>
                <Text style={[styles.lotQty, { color: colors.foreground }]} numberOfLines={1}>
                  {fmtQty(loc.onHand)} {item.unit}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Reorder threshold (editing is an inventory-item write → manage-inventory) */}
      <View style={styles.thresholdRow}>
        <Text style={[styles.detailInline, { color: colors.mutedForeground }]}>Reorder at</Text>
        {!canManageInventory ? (
          <Text style={[styles.thresholdValText, { color: colors.foreground }]}>
            {fmtQty(item.reorderThreshold)} {item.unit}
          </Text>
        ) : editThreshold ? (
          <View style={styles.thresholdEdit}>
            <TextInput
              value={thresholdVal}
              onChangeText={setThresholdVal}
              keyboardType="numeric"
              style={[styles.inputSm, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
            />
            <Button
              label="Save"
              size="sm"
              disabled={busy}
              onPress={() =>
                run(async () => {
                  await updateInventoryItem(item.id, { reorderThreshold: Number(thresholdVal) || 0 });
                  setEditThreshold(false);
                })
              }
            />
          </View>
        ) : (
          <Pressable onPress={() => setEditThreshold(true)} style={styles.thresholdView}>
            <Text style={[styles.thresholdValText, { color: colors.foreground }]}>
              {fmtQty(item.reorderThreshold)} {item.unit}
            </Text>
            <Feather name="edit-2" size={12} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      <View style={[styles.sep, { backgroundColor: colors.border }]} />

      <RestockForm item={item} busy={busy} locations={locations} run={run} />
      <AdjustForm item={item} busy={busy} run={run} />

      {/* Transfer stock between locations. Open to any signed-in user (same as
          restock). Hidden until at least two locations exist. */}
      {locations.length > 1 && (
        <TransferForm item={item} locations={locations} busy={busy} run={run} />
      )}

      <View style={[styles.sep, { backgroundColor: colors.border }]} />

      {/* History */}
      <Pressable onPress={loadHistory} style={styles.historyToggle}>
        <Feather name="clock" size={14} color={colors.mutedForeground} />
        <Text style={[styles.historyToggleText, { color: colors.mutedForeground }]}>
          {showHistory ? "Hide" : "Show"} history
        </Text>
      </Pressable>
      {showHistory && (
        <View style={{ gap: 4 }}>
          {history == null ? (
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading…</Text>
          ) : history.length === 0 ? (
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>No history.</Text>
          ) : (
            history.map((h) => (
              <View key={h.id} style={styles.lotRow}>
                <Text style={[styles.lotText, { color: colors.mutedForeground }]} numberOfLines={1}>
                  <Text style={{ fontFamily: FONTS.medium }}>{h.type.toUpperCase()}</Text>
                  {` · ${fmtDateTime(h.createdAt)}`}
                  {h.note ? ` · ${h.note}` : ""}
                </Text>
                <Text
                  style={[
                    styles.lotQty,
                    { color: h.qtyDelta < 0 ? colors.destructive : colors.success ?? colors.primary },
                  ]}
                  numberOfLines={1}
                >
                  {h.qtyDelta > 0 ? "+" : ""}
                  {fmtQty(h.qtyDelta)}
                </Text>
              </View>
            ))
          )}
        </View>
      )}

      {canManageInventory && (
        <>
          <View style={[styles.sep, { backgroundColor: colors.border }]} />
          <Button
            label="Delete item"
            icon="trash-2"
            variant="destructive"
            size="sm"
            disabled={busy}
            onPress={() => run(() => deleteInventoryItem(item.id))}
          />
        </>
      )}
    </View>
  );
}

function RestockForm({
  item,
  busy,
  locations,
  run,
}: {
  item: InventoryItem;
  busy: boolean;
  locations: InventoryLocation[];
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const colors = useColors();
  const [qty, setQty] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [expiration, setExpiration] = useState("");
  // Default the restock destination to the onsite location (empty === server's
  // default onsite). Only shown when more than one location exists.
  const [locationId, setLocationId] = useState<string>("");
  const n = Number(qty);
  const inputStyle = [
    styles.input,
    { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
  ];
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>RESTOCK</Text>
      <View style={styles.formRow}>
        <TextInput
          placeholder="Qty"
          placeholderTextColor={colors.mutedForeground}
          value={qty}
          onChangeText={setQty}
          keyboardType="numeric"
          style={[inputStyle, { flex: 1 }]}
        />
        <TextInput
          placeholder="Lot #"
          placeholderTextColor={colors.mutedForeground}
          value={lotNumber}
          onChangeText={setLotNumber}
          style={[inputStyle, { flex: 1 }]}
        />
        <TextInput
          placeholder="Exp YYYY-MM-DD"
          placeholderTextColor={colors.mutedForeground}
          value={expiration}
          onChangeText={setExpiration}
          autoCapitalize="none"
          style={[inputStyle, { flex: 1.4 }]}
        />
      </View>
      {locations.length > 1 && (
        <SelectField
          value={locationId}
          onChange={setLocationId}
          options={locations.map((l) => String(l.id))}
          optionLabel={(id) => {
            const loc = locations.find((l) => String(l.id) === id);
            return loc ? `${loc.name}${loc.isOnsite ? " (onsite)" : ""}` : id;
          }}
          allowAdd={false}
          placeholder="Onsite (default)"
        />
      )}
      <Button
        label="Add stock"
        icon="plus"
        size="sm"
        disabled={busy || !(n > 0)}
        onPress={() =>
          run(async () => {
            await restockInventory({
              itemKey: item.key,
              category: item.category,
              name: item.name,
              unit: item.unit,
              qty: n,
              lotNumber: lotNumber.trim() || undefined,
              receivedDate: todayStr(),
              expirationDate: expiration.trim() || undefined,
              locationId: locationId ? Number(locationId) : undefined,
            });
            setQty("");
            setLotNumber("");
            setExpiration("");
          })
        }
      />
    </View>
  );
}

function TransferForm({
  item,
  locations,
  busy,
  run,
}: {
  item: InventoryItem;
  locations: InventoryLocation[];
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const colors = useColors();
  const onsite = locations.find((l) => l.isOnsite);
  const offsite = locations.filter((l) => !l.isOnsite);
  // Default: move from the first offsite location into onsite (the common case
  // that resolves a transfer warning).
  const [fromId, setFromId] = useState<string>(String(offsite[0]?.id ?? ""));
  const [toId, setToId] = useState<string>(String(onsite?.id ?? ""));
  const [qty, setQty] = useState("");
  const n = Number(qty);
  // On-hand at the chosen source, so the user can't move more than is there.
  const sourceOnHand =
    item.byLocation.find((b) => String(b.locationId) === fromId)?.onHand ?? 0;
  const valid =
    n > 0 && fromId !== "" && toId !== "" && fromId !== toId && n <= sourceOnHand + 1e-6;
  const optionLabel = (id: string) => {
    const loc = locations.find((l) => String(l.id) === id);
    return loc ? `${loc.name}${loc.isOnsite ? " (onsite)" : ""}` : id;
  };
  const inputStyle = [
    styles.input,
    { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
  ];
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>TRANSFER</Text>
      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <SelectField
            value={fromId}
            onChange={setFromId}
            options={locations.map((l) => String(l.id))}
            optionLabel={optionLabel}
            allowAdd={false}
            placeholder="From…"
          />
        </View>
        <View style={{ flex: 1 }}>
          <SelectField
            value={toId}
            onChange={setToId}
            options={locations.map((l) => String(l.id))}
            optionLabel={optionLabel}
            allowAdd={false}
            placeholder="To…"
          />
        </View>
      </View>
      <TextInput
        placeholder={`Qty (max ${fmtQty(sourceOnHand)})`}
        placeholderTextColor={colors.mutedForeground}
        value={qty}
        onChangeText={setQty}
        keyboardType="numeric"
        style={inputStyle}
      />
      <Button
        label="Move stock"
        icon="repeat"
        variant="outline"
        size="sm"
        disabled={busy || !valid}
        onPress={() =>
          run(async () => {
            await transferInventory({
              itemId: item.id,
              fromLocationId: Number(fromId),
              toLocationId: Number(toId),
              qty: n,
            });
            setQty("");
          })
        }
      />
    </View>
  );
}

function AdjustForm({
  item,
  busy,
  run,
}: {
  item: InventoryItem;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const colors = useColors();
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const n = Number(delta);
  const inputStyle = [
    styles.input,
    { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
  ];
  return (
    <View style={{ gap: 6, marginTop: 10 }}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>MANUAL ADJUSTMENT</Text>
      <View style={styles.formRow}>
        <TextInput
          placeholder="± Qty"
          placeholderTextColor={colors.mutedForeground}
          value={delta}
          onChangeText={setDelta}
          keyboardType="numbers-and-punctuation"
          style={[inputStyle, { flex: 1 }]}
        />
        <TextInput
          placeholder="Reason"
          placeholderTextColor={colors.mutedForeground}
          value={note}
          onChangeText={setNote}
          style={[inputStyle, { flex: 1.6 }]}
        />
      </View>
      <Button
        label="Apply adjustment"
        variant="outline"
        size="sm"
        disabled={busy || !(n !== 0) || Number.isNaN(n)}
        onPress={() =>
          run(async () => {
            await adjustInventory({ itemId: item.id, qtyDelta: n, note: note.trim() || undefined });
            setDelta("");
            setNote("");
          })
        }
      />
    </View>
  );
}

function LocationsCard({
  locations,
  onChanged,
}: {
  locations: InventoryLocation[];
  onChanged: () => void;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const inputStyle = [
    styles.input,
    { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
  ];

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(
        e instanceof InventoryApiError && e.serverMessage
          ? e.serverMessage
          : e instanceof Error
            ? e.message
            : "Action failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Locations" icon="map-pin" style={{ marginBottom: 16 }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [
          styles.toggleBtn,
          { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Feather name={open ? "chevron-down" : "settings"} size={14} color={colors.mutedForeground} />
        <Text style={[styles.toggleBtnText, { color: colors.mutedForeground }]}>
          {open ? "Close" : "Manage"}
        </Text>
      </Pressable>
      {open && (
        <View style={{ marginTop: 12, gap: 8 }}>
          {error && <Text style={[styles.muted, { color: colors.destructive }]}>{error}</Text>}
          <View style={{ gap: 6 }}>
            {locations.map((loc) => (
              <View
                key={loc.id}
                style={[styles.itemRow, { borderColor: colors.border, backgroundColor: colors.secondary, padding: 10 }]}
              >
                {editId === loc.id ? (
                  <View style={[styles.formRow, { alignItems: "center" }]}>
                    <TextInput
                      value={editName}
                      onChangeText={setEditName}
                      style={[inputStyle, { flex: 1 }]}
                    />
                    <Button
                      label="Save"
                      size="sm"
                      disabled={busy || !editName.trim()}
                      onPress={() =>
                        run(async () => {
                          await updateInventoryLocation(loc.id, { name: editName.trim() });
                          setEditId(null);
                        })
                      }
                    />
                  </View>
                ) : (
                  <View style={styles.alertRow}>
                    <View style={styles.itemHeaderLeft}>
                      <Text style={[styles.itemName, { color: colors.foreground }]} numberOfLines={1}>
                        {loc.name}
                      </Text>
                      {loc.isOnsite && (
                        <View style={[styles.lowBadge, { borderColor: colors.success ?? colors.primary }]}>
                          <Text style={[styles.lowBadgeText, { color: colors.success ?? colors.primary }]}>ONSITE</Text>
                        </View>
                      )}
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                      {!loc.isOnsite && (
                        <Pressable
                          disabled={busy}
                          onPress={() => run(() => updateInventoryLocation(loc.id, { isOnsite: true }))}
                          hitSlop={6}
                        >
                          <Text style={{ color: colors.success ?? colors.primary, fontFamily: FONTS.medium, fontSize: 12 }}>
                            Set onsite
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => {
                          setEditId(loc.id);
                          setEditName(loc.name);
                        }}
                        hitSlop={6}
                      >
                        <Feather name="edit-2" size={14} color={colors.mutedForeground} />
                      </Pressable>
                      {!loc.isOnsite && (
                        <Pressable disabled={busy} onPress={() => run(() => deleteInventoryLocation(loc.id))} hitSlop={6}>
                          <Feather name="trash-2" size={14} color={colors.destructive} />
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
              </View>
            ))}
          </View>
          <View style={[styles.formRow, { alignItems: "center" }]}>
            <TextInput
              placeholder="New location name"
              placeholderTextColor={colors.mutedForeground}
              value={newName}
              onChangeText={setNewName}
              style={[inputStyle, { flex: 1 }]}
            />
            <Button
              label="Add"
              icon="plus"
              size="sm"
              disabled={busy || !newName.trim()}
              onPress={() =>
                run(async () => {
                  await createInventoryLocation({ name: newName.trim() });
                  setNewName("");
                })
              }
            />
          </View>
          <Text style={[styles.settingsHint, { color: colors.mutedForeground }]}>
            Production deducts only from the onsite location. Stock in other locations is warned about when it could be transferred in to cover the day's plan.
          </Text>
        </View>
      )}
    </Card>
  );
}

function AddItemForm({
  candidates,
  onAdded,
}: {
  candidates: CandidateItem[];
  onAdded: () => void;
}) {
  const colors = useColors();
  const [mode, setMode] = useState<"candidate" | "custom">(
    candidates.length > 0 ? "candidate" : "custom",
  );
  const [selectedKey, setSelectedKey] = useState(candidates[0]?.key ?? "");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState<"ingredient" | "packaging">("ingredient");
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);

  const inputStyle = [
    styles.input,
    { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
  ];

  async function submit() {
    setBusy(true);
    try {
      if (mode === "candidate") {
        const c = candidates.find((x) => x.key === selectedKey);
        if (!c) return;
        await createInventoryItem({
          key: c.key,
          category: c.category,
          name: c.name,
          unit: c.unit,
          reorderThreshold: Number(threshold) || 0,
        });
      } else {
        const trimmed = name.trim();
        if (!trimmed) return;
        const u = unit.trim() || "units";
        await createInventoryItem({
          key: `${category}:${trimmed}:${u}`,
          category,
          name: trimmed,
          unit: u,
          reorderThreshold: Number(threshold) || 0,
        });
      }
      onAdded();
    } catch {
      /* parent reloads */
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.modeRow}>
        <Pressable
          onPress={() => candidates.length > 0 && setMode("candidate")}
          disabled={candidates.length === 0}
          style={[
            styles.modeBtn,
            {
              borderColor: mode === "candidate" ? colors.primary : colors.border,
              backgroundColor: mode === "candidate" ? colors.primary + "1A" : "transparent",
              opacity: candidates.length === 0 ? 0.4 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.modeBtnText,
              { color: mode === "candidate" ? colors.primary : colors.mutedForeground },
            ]}
          >
            From production
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMode("custom")}
          style={[
            styles.modeBtn,
            {
              borderColor: mode === "custom" ? colors.primary : colors.border,
              backgroundColor: mode === "custom" ? colors.primary + "1A" : "transparent",
            },
          ]}
        >
          <Text
            style={[
              styles.modeBtnText,
              { color: mode === "custom" ? colors.primary : colors.mutedForeground },
            ]}
          >
            Custom
          </Text>
        </Pressable>
      </View>

      {mode === "candidate" ? (
        candidates.length === 0 ? (
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>
            All production items already tracked. Use Custom to add others.
          </Text>
        ) : (
          <View style={{ gap: 6 }}>
            {candidates.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => setSelectedKey(c.key)}
                style={[
                  styles.candidateRow,
                  {
                    borderColor: selectedKey === c.key ? colors.primary : colors.border,
                    backgroundColor: selectedKey === c.key ? colors.primary + "1A" : "transparent",
                  },
                ]}
              >
                <Feather
                  name={selectedKey === c.key ? "check-circle" : "circle"}
                  size={16}
                  color={selectedKey === c.key ? colors.primary : colors.mutedForeground}
                />
                <Text style={[styles.candidateText, { color: colors.foreground }]} numberOfLines={1}>
                  {c.name} ({c.unit})
                </Text>
              </Pressable>
            ))}
          </View>
        )
      ) : (
        <View style={{ gap: 6 }}>
          <TextInput
            placeholder="Item name"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
            style={inputStyle}
          />
          <View style={styles.formRow}>
            <TextInput
              placeholder="Unit (e.g. lbs)"
              placeholderTextColor={colors.mutedForeground}
              value={unit}
              onChangeText={setUnit}
              style={[inputStyle, { flex: 1 }]}
            />
            <Pressable
              onPress={() =>
                setCategory((c) => (c === "ingredient" ? "packaging" : "ingredient"))
              }
              style={[
                styles.input,
                styles.categoryToggle,
                { borderColor: colors.border, backgroundColor: colors.background, flex: 1 },
              ]}
            >
              <Text style={{ color: colors.foreground, fontFamily: FONTS.regular, fontSize: 13 }}>
                {category === "ingredient" ? "Ingredient" : "Packaging"}
              </Text>
              <Feather name="repeat" size={13} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </View>
      )}

      <TextInput
        placeholder="Reorder threshold (optional)"
        placeholderTextColor={colors.mutedForeground}
        value={threshold}
        onChangeText={setThreshold}
        keyboardType="numeric"
        style={inputStyle}
      />
      <Button label="Add to inventory" icon="plus" size="sm" disabled={busy} onPress={submit} />
    </View>
  );
}

// ── Photo stock intake ───────────────────────────────────────────────────────
const MAX_PHOTO_EDGE = 1280;

// Downscale/compress a captured or picked image to a JPEG and return its base64
// payload, kept (best-effort) under the server's size cap. Progressively shrinks
// the max edge and quality until the payload fits, so oversized originals are
// handled gracefully instead of being rejected with a 413 after the upload.
async function prepareImageBase64(
  uri: string,
  width: number,
  height: number,
): Promise<string | null> {
  const steps: Array<{ edge: number; quality: number }> = [
    { edge: MAX_PHOTO_EDGE, quality: 0.6 },
    { edge: MAX_PHOTO_EDGE, quality: 0.45 },
    { edge: 1024, quality: 0.45 },
    { edge: 800, quality: 0.4 },
    { edge: 640, quality: 0.4 },
  ];
  const longest = Math.max(width, height);
  let last: string | null = null;
  for (const { edge, quality } of steps) {
    const context = ImageManipulator.ImageManipulator.manipulate(uri);
    if (longest > edge) {
      if (width >= height) context.resize({ width: edge });
      else context.resize({ height: edge });
    }
    const image = await context.renderAsync();
    const result = await image.saveAsync({
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    last = result.base64 ?? null;
    if (last && last.length <= MAX_IMAGE_BASE64_CHARS) return last;
  }
  // Even the smallest step exceeded the cap (extremely unlikely): return it
  // anyway so the server can surface its own clear 413 message.
  return last;
}

interface ReviewRow {
  id: string;
  guessName: string;
  name: string;
  qty: string;
  unit: string;
  category: InventoryCategory;
  matchedKey: string | null;
  confidence: number;
  lotNumber: string;
  expiration: string;
}

const NEW_ITEM = "__new__";

function PhotoIntakeCard({
  candidates,
  locations,
  onCommitted,
}: {
  candidates: CandidateItem[];
  locations: InventoryLocation[];
  onCommitted: () => void;
}) {
  const colors = useColors();
  // Destination location for all confirmed rows (empty === server default
  // onsite). Only shown when more than one location exists, mirroring the
  // manual RestockForm picker.
  const [locationId, setLocationId] = useState<string>("");
  const lastImageRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [noResults, setNoResults] = useState(false);
  const [committingId, setCommittingId] = useState<string | null>(null);
  // Server-persisted learned photo aliases (guessName -> itemKey), factory-wide.
  // Fetched once on mount; best-effort, so any failure leaves the list empty.
  const [photoAliases, setPhotoAliases] = useState<PhotoAlias[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchPhotoAliases()
      .then((a) => {
        if (!cancelled) setPhotoAliases(a);
      })
      .catch(() => {
        /* best-effort: proceed without learned aliases */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Count down the rate-limit (429) cooldown so the retry button re-enables
  // exactly when the server will accept another request.
  const counting = retryIn > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setRetryIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [counting]);

  const candByKey = useMemo(() => {
    const m = new Map<string, CandidateItem>();
    for (const c of candidates) m.set(c.key, c);
    return m;
  }, [candidates]);

  const inputStyle = [
    styles.input,
    { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
  ];

  function toRows(guesses: PhotoGuess[]): ReviewRow[] {
    return guesses.map((g, i) => {
      // Prefer the server's match; otherwise fall back to a learned alias for
      // this guess name (only if that item still exists among candidates).
      const learnedKey = g.matchedKey
        ? null
        : applyPhotoAliases(g.name, photoAliases, candidates);
      const effectiveKey = g.matchedKey ?? learnedKey;
      const matched = effectiveKey ? candByKey.get(effectiveKey) : undefined;
      return {
        id: `${Date.now()}-${i}`,
        guessName: g.name,
        name: matched?.name ?? g.name,
        qty: g.qty > 0 ? fmtQty(g.qty) : "",
        unit: matched?.unit ?? g.unit,
        category: matched?.category ?? g.category,
        matchedKey: matched?.key ?? null,
        confidence: g.confidence,
        lotNumber: "",
        expiration: "",
      };
    });
  }

  async function analyze(base64: string | null | undefined) {
    if (!base64) return;
    lastImageRef.current = base64;
    setError(null);
    setNoResults(false);
    setRows([]);
    setRetryIn(0);
    setAnalyzing(true);
    try {
      const { items } = await identifyInventoryPhoto({
        imageBase64: base64,
        mimeType: "image/jpeg",
        candidates,
      });
      const next = toRows(items);
      setRows(next);
      setNoResults(next.length === 0);
    } catch (e) {
      setError(photoErrorMessage(e));
      if (e instanceof InventoryApiError && e.status === 429 && e.retryAfterSec && e.retryAfterSec > 0) {
        setRetryIn(e.retryAfterSec);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  // Re-run analysis on the last captured image without re-opening the camera.
  function retry() {
    if (lastImageRef.current) void analyze(lastImageRef.current);
  }

  // Analyze several photos in ONE intake: each image is its own AI call (run
  // sequentially to respect the endpoint's cost/rate guards) and the identified
  // rows are ACCUMULATED into the review list rather than clobbering it, so the
  // user confirms one combined list. Mirrors the web multi-image picker.
  async function analyzeMany(images: string[]) {
    lastImageRef.current = images[images.length - 1] ?? null;
    setError(null);
    setNoResults(false);
    setRows([]);
    setRetryIn(0);
    setAnalyzing(true);
    setAnalyzeProgress({ done: 0, total: images.length });
    let any = false;
    try {
      for (let i = 0; i < images.length; i++) {
        try {
          const { items } = await identifyInventoryPhoto({
            imageBase64: images[i],
            mimeType: "image/jpeg",
            candidates,
          });
          const next = toRows(items);
          if (next.length) {
            any = true;
            setRows((rs) => [...rs, ...next]);
          }
        } catch (e) {
          // Surface the error but keep going so one bad photo doesn't sink the batch.
          setError(photoErrorMessage(e));
          if (e instanceof InventoryApiError && e.status === 429 && e.retryAfterSec && e.retryAfterSec > 0) {
            setRetryIn(e.retryAfterSec);
            break; // rate-limited: stop hammering the endpoint
          }
        } finally {
          setAnalyzeProgress({ done: i + 1, total: images.length });
        }
      }
      setNoResults(!any);
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress(null);
    }
  }

  // Downscale/compress the chosen asset before handing it to analyze(), so the
  // payload stays under the server's size cap regardless of the original size.
  async function analyzeAsset(asset: ImagePicker.ImagePickerAsset | undefined) {
    if (!asset?.uri) return;
    let base64: string | null;
    setPreparing(true);
    try {
      base64 = await prepareImageBase64(
        asset.uri,
        asset.width ?? MAX_PHOTO_EDGE,
        asset.height ?? MAX_PHOTO_EDGE,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to process photo");
      return;
    } finally {
      setPreparing(false);
    }
    await analyze(base64);
  }

  // Prepare several picked assets (compress each, skip any that fail) and hand
  // the resulting images to analyzeMany for accumulation.
  async function analyzeAssets(assets: ImagePicker.ImagePickerAsset[]) {
    const usable = assets.filter((a) => a?.uri);
    if (usable.length === 0) return;
    if (usable.length === 1) {
      await analyzeAsset(usable[0]);
      return;
    }
    let images: string[];
    setPreparing(true);
    try {
      const prepared = await Promise.all(
        usable.map((a) =>
          prepareImageBase64(a.uri, a.width ?? MAX_PHOTO_EDGE, a.height ?? MAX_PHOTO_EDGE).catch(
            () => null,
          ),
        ),
      );
      images = prepared.filter((b): b is string => !!b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to process photos");
      return;
    } finally {
      setPreparing(false);
    }
    if (images.length === 0) {
      setError("Failed to process photos");
      return;
    }
    await analyzeMany(images);
  }

  async function takePhoto() {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError("Camera permission is required to take a photo.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      quality: 1,
      mediaTypes: ["images"],
    });
    if (!res.canceled) await analyzeAsset(res.assets[0]);
  }

  async function pickPhoto() {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      quality: 1,
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
    });
    if (!res.canceled) await analyzeAssets(res.assets);
  }

  function patch(id: string, p: Partial<ReviewRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  // Re-map a review row to an existing inventory item, or back to a new item.
  // When matched, the row's name/unit/category lock to the chosen item so what
  // the user sees is exactly what gets committed.
  function setMatch(id: string, key: string) {
    if (key === NEW_ITEM) {
      setRows((rs) =>
        rs.map((r) => (r.id === id ? { ...r, matchedKey: null, name: r.guessName } : r)),
      );
      return;
    }
    const c = candByKey.get(key);
    if (!c) return;
    patch(id, { matchedKey: c.key, name: c.name, unit: c.unit, category: c.category });
  }

  async function confirmRow(row: ReviewRow) {
    const n = Number(row.qty);
    if (!(n > 0)) return;
    const name = row.name.trim();
    if (!name) return;
    const unit = row.unit.trim() || "units";
    // matched rows commit the matched item's stable key; new items derive one.
    const itemKey = row.matchedKey ?? `${row.category}:${name}:${unit}`;
    setCommittingId(row.id);
    try {
      await restockInventory({
        itemKey,
        category: row.category,
        name,
        unit,
        qty: n,
        lotNumber: row.lotNumber.trim() || undefined,
        receivedDate: todayStr(),
        expirationDate: row.expiration.trim() || undefined,
        locationId: locationId ? Number(locationId) : undefined,
      });
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      // Remember the guessName -> matched item link so future scans auto-apply
      // it. Only when matched to an existing item and the guess differs from the
      // item name (skip trivial self-references, like the import-alias path).
      if (
        row.matchedKey &&
        row.guessName.trim() &&
        row.guessName.trim().toLowerCase() !== name.toLowerCase()
      ) {
        const alias: PhotoAlias = { guessName: row.guessName.trim(), itemKey: row.matchedKey };
        setPhotoAliases((prev) => {
          const others = prev.filter(
            (a) => a.guessName.trim().toLowerCase() !== alias.guessName.toLowerCase(),
          );
          return [...others, alias];
        });
        void savePhotoAliases([alias]).catch(() => {
          /* best-effort */
        });
      }
      onCommitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add stock");
    } finally {
      setCommittingId(null);
    }
  }

  return (
    <Card title="Photo Intake" icon="camera" style={{ marginBottom: 16 }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [
          styles.toggleBtn,
          { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Feather name={open ? "chevron-down" : "camera"} size={14} color={colors.mutedForeground} />
        <Text style={[styles.toggleBtnText, { color: colors.mutedForeground }]}>
          {open ? "Close" : "Scan"}
        </Text>
      </Pressable>

      {open && (
        <View style={{ marginTop: 12, gap: 10 }}>
          <Text style={[styles.muted, { color: colors.mutedForeground, fontStyle: "normal" }]}>
            Take or upload a photo of incoming stock. We'll identify the items and pre-fill
            restock entries for you to confirm.
          </Text>
          <View style={styles.formRow}>
            <View style={{ flex: 1 }}>
              <Button label="Take photo" icon="camera" size="sm" disabled={preparing || analyzing} onPress={takePhoto} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Upload" icon="image" variant="outline" size="sm" disabled={preparing || analyzing} onPress={pickPhoto} />
            </View>
          </View>

          {(preparing || analyzing) && (
            <View style={styles.analyzingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.muted, { color: colors.mutedForeground, fontStyle: "normal" }]}>
                {preparing
                  ? "Preparing photos…"
                  : analyzeProgress && analyzeProgress.total > 1
                    ? `Analyzing photo ${Math.min(analyzeProgress.done + 1, analyzeProgress.total)} of ${analyzeProgress.total}…`
                    : "Analyzing photo…"}
              </Text>
            </View>
          )}
          {error && (
            <View style={{ gap: 6 }}>
              <Text style={[styles.muted, { color: colors.destructive }]}>{error}</Text>
              {lastImageRef.current && (
                <Button
                  label={retryIn > 0 ? `Try again in ${retryIn}s` : "Try again"}
                  icon="refresh-cw"
                  variant="outline"
                  size="sm"
                  disabled={analyzing || retryIn > 0}
                  onPress={retry}
                />
              )}
            </View>
          )}
          {noResults && (
            <View style={{ gap: 6 }}>
              <Text style={[styles.muted, { color: colors.mutedForeground, fontStyle: "normal" }]}>
                Couldn't identify any items. Try a clearer photo, or add stock manually above.
              </Text>
              <Button
                label="Take another photo"
                icon="camera"
                variant="outline"
                size="sm"
                disabled={analyzing}
                onPress={takePhoto}
              />
            </View>
          )}

          {rows.length > 0 && locations.length > 1 && (
            <View style={{ gap: 4 }}>
              <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
                DESTINATION LOCATION
              </Text>
              <SelectField
                value={locationId}
                onChange={setLocationId}
                options={locations.map((l) => String(l.id))}
                optionLabel={(id) => {
                  const loc = locations.find((l) => String(l.id) === id);
                  return loc ? `${loc.name}${loc.isOnsite ? " (onsite)" : ""}` : id;
                }}
                allowAdd={false}
                placeholder="Onsite (default)"
              />
            </View>
          )}

          {rows.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
                REVIEW &amp; CONFIRM ({rows.length})
              </Text>
              {rows.map((row) => {
                const lowConf = row.confidence < 0.5;
                const ranked = rankCandidatesByName(row.guessName, candidates);
                const matchedLocked = !!row.matchedKey;
                return (
                  <View
                    key={row.id}
                    style={[styles.reviewRow, { borderColor: colors.border, backgroundColor: colors.secondary }]}
                  >
                    <View style={styles.reviewHeader}>
                      <View style={styles.reviewBadges}>
                        <View
                          style={[
                            styles.badge,
                            { borderColor: row.matchedKey ? (colors.success ?? colors.primary) : colors.primary },
                          ]}
                        >
                          <Text
                            style={[
                              styles.badgeText,
                              { color: row.matchedKey ? (colors.success ?? colors.primary) : colors.primary },
                            ]}
                          >
                            {row.matchedKey ? "MATCH" : "NEW"}
                          </Text>
                        </View>
                        {lowConf && (
                          <View style={[styles.badge, { borderColor: colors.warning }]}>
                            <Text style={[styles.badgeText, { color: colors.warning }]}>LOW CONF</Text>
                          </View>
                        )}
                      </View>
                      <Pressable onPress={() => setRows((rs) => rs.filter((r) => r.id !== row.id))} hitSlop={8}>
                        <Feather name="x" size={16} color={colors.mutedForeground} />
                      </Pressable>
                    </View>
                    {candidates.length > 0 && (
                      <View style={{ gap: 4 }}>
                        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>MATCH TO</Text>
                        <View style={styles.matchChips}>
                          <Pressable
                            onPress={() => setMatch(row.id, NEW_ITEM)}
                            style={[
                              styles.matchChip,
                              { borderColor: row.matchedKey ? colors.border : colors.primary,
                                backgroundColor: row.matchedKey ? colors.background : colors.primary },
                            ]}
                          >
                            <Text
                              style={[
                                styles.matchChipText,
                                { color: row.matchedKey ? colors.foreground : colors.primaryForeground },
                              ]}
                            >
                              + New
                            </Text>
                          </Pressable>
                          {ranked.map((c) => {
                            const active = row.matchedKey === c.key;
                            return (
                              <Pressable
                                key={c.key}
                                onPress={() => setMatch(row.id, c.key)}
                                style={[
                                  styles.matchChip,
                                  { borderColor: active ? colors.primary : colors.border,
                                    backgroundColor: active ? colors.primary : colors.background },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.matchChipText,
                                    { color: active ? colors.primaryForeground : colors.foreground },
                                  ]}
                                >
                                  {c.name}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    )}
                    <TextInput
                      placeholder="Item name"
                      placeholderTextColor={colors.mutedForeground}
                      value={row.name}
                      editable={!matchedLocked}
                      onChangeText={(t) => patch(row.id, { name: t })}
                      style={[inputStyle, matchedLocked && { opacity: 0.5 }]}
                    />
                    <View style={styles.formRow}>
                      <TextInput
                        placeholder="Qty"
                        placeholderTextColor={colors.mutedForeground}
                        value={row.qty}
                        onChangeText={(t) => patch(row.id, { qty: t })}
                        keyboardType="numeric"
                        style={[inputStyle, { flex: 1 }]}
                      />
                      <TextInput
                        placeholder="Unit"
                        placeholderTextColor={colors.mutedForeground}
                        value={row.unit}
                        editable={!row.matchedKey}
                        onChangeText={(t) => patch(row.id, { unit: t })}
                        style={[inputStyle, { flex: 1 }, !!row.matchedKey && { opacity: 0.5 }]}
                      />
                      <Pressable
                        disabled={!!row.matchedKey}
                        onPress={() =>
                          patch(row.id, {
                            category: row.category === "ingredient" ? "packaging" : "ingredient",
                          })
                        }
                        style={[
                          styles.input,
                          styles.categoryToggle,
                          { borderColor: colors.border, backgroundColor: colors.background, flex: 1.2 },
                          !!row.matchedKey && { opacity: 0.5 },
                        ]}
                      >
                        <Text style={{ color: colors.foreground, fontFamily: FONTS.regular, fontSize: 12 }}>
                          {row.category === "ingredient" ? "Ingr." : "Pkg."}
                        </Text>
                        <Feather name="repeat" size={12} color={colors.mutedForeground} />
                      </Pressable>
                    </View>
                    <View style={styles.formRow}>
                      <TextInput
                        placeholder="Lot #"
                        placeholderTextColor={colors.mutedForeground}
                        value={row.lotNumber}
                        onChangeText={(t) => patch(row.id, { lotNumber: t })}
                        style={[inputStyle, { flex: 1 }]}
                      />
                      <TextInput
                        placeholder="Exp YYYY-MM-DD"
                        placeholderTextColor={colors.mutedForeground}
                        value={row.expiration}
                        onChangeText={(t) => patch(row.id, { expiration: t })}
                        autoCapitalize="none"
                        style={[inputStyle, { flex: 1.4 }]}
                      />
                    </View>
                    <Button
                      label={committingId === row.id ? "Adding…" : "Confirm & add stock"}
                      icon="plus"
                      size="sm"
                      disabled={committingId === row.id || !(Number(row.qty) > 0) || !row.name.trim()}
                      onPress={() => confirmRow(row)}
                    />
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

// ── AI quality/defect photo check (read-only) ────────────────────────────────
// Photograph a finished pizza/crust for an AI quality assessment. Advisory only
// — nothing is recorded unless the user reviews and confirms the outcome, which
// writes a single fact to shared facility memory. Mirrors the web card.
function qualityStatusMeta(
  status: QualityStatus,
  colors: ReturnType<typeof useColors>,
): { label: string; color: string; icon: keyof typeof Feather.glyphMap } {
  switch (status) {
    case "pass":
      return { label: "Looks good", color: colors.success ?? colors.primary, icon: "check-circle" };
    case "warn":
      return { label: "Minor issues", color: colors.warning, icon: "alert-triangle" };
    case "fail":
      return { label: "Defects found", color: colors.destructive, icon: "alert-triangle" };
  }
}

function QualityCheckCard() {
  const colors = useColors();
  const qc = useQueryClient();
  const lastImageRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [productType, setProductType] = useState<QualityProductType>("pizza");
  const [notes, setNotes] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const [result, setResult] = useState<QualityCheckResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const counting = retryIn > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setRetryIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [counting]);

  const inputStyle = [
    styles.input,
    { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
  ];

  async function analyze(imageBase64: string | null | undefined) {
    if (!imageBase64) return;
    lastImageRef.current = imageBase64;
    setError(null);
    setResult(null);
    setConfirmed(false);
    setRetryIn(0);
    setAnalyzing(true);
    try {
      const res = await qualityCheckPhoto({
        imageBase64,
        mimeType: "image/jpeg",
        productType,
        notes: notes.trim() || undefined,
      });
      setResult(res);
    } catch (e) {
      setError(photoErrorMessage(e));
      if (e instanceof InventoryApiError && e.status === 429 && e.retryAfterSec && e.retryAfterSec > 0) {
        setRetryIn(e.retryAfterSec);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  function retry() {
    if (lastImageRef.current) void analyze(lastImageRef.current);
  }

  async function analyzeAsset(asset: ImagePicker.ImagePickerAsset | undefined) {
    if (!asset?.uri) return;
    let base64: string | null;
    setPreparing(true);
    try {
      base64 = await prepareImageBase64(
        asset.uri,
        asset.width ?? MAX_PHOTO_EDGE,
        asset.height ?? MAX_PHOTO_EDGE,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to process photo");
      return;
    } finally {
      setPreparing(false);
    }
    await analyze(base64);
  }

  async function takePhoto() {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError("Camera permission is required to take a photo.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 1, mediaTypes: ["images"] });
    if (!res.canceled) await analyzeAsset(res.assets[0]);
  }

  async function pickPhoto() {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 1, mediaTypes: ["images"] });
    if (!res.canceled) await analyzeAsset(res.assets[0]);
  }

  // Record the reviewed outcome. This is the ONLY write — the assessment itself
  // is never auto-saved. Two things happen on confirm:
  //   1. A structured row is persisted into the browsable manager Quality
  //      History (date, product, verdict, confidence, issues, optional photo).
  //   2. A free-text fact is recorded into shared facility memory so future AI
  //      checks are grounded in it.
  async function confirmOutcome() {
    if (!result) return;
    const a = result.assessment;
    setConfirming(true);
    setError(null);
    try {
      const thumbnail = lastImageRef.current
        ? `data:image/jpeg;base64,${lastImageRef.current}`
        : undefined;
      await recordQualityCheck({
        productType,
        status: a.status,
        confidence: a.confidence,
        summary: a.summary,
        issues: a.issues,
        notes: notes.trim() || undefined,
        thumbnail,
      });
      void qc.invalidateQueries({ queryKey: ["qualityChecks"] });

      const issueText = a.issues.length
        ? ` Issues: ${a.issues.map((i) => `${i.type} (${i.severity}) — ${i.detail}`).join("; ")}.`
        : "";
      // Best-effort: the structured record above is the source of truth, so a
      // facility-memory write failure must not undo a successful save.
      try {
        await saveFacilityKnowledge([
          {
            domain: "quality",
            key: `check:${productType}:${todayStr()}`,
            fact:
              `On ${todayStr()}, a ${productType} quality check was reviewed and confirmed as ` +
              `"${a.status}" (${Math.round(a.confidence * 100)}% confidence). ${a.summary}${issueText}`,
          },
        ]);
      } catch {
        // ignore — the history record persisted
      }
      setConfirmed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save outcome");
    } finally {
      setConfirming(false);
    }
  }

  const meta = result ? qualityStatusMeta(result.assessment.status, colors) : null;

  return (
    <Card title="Quality Check" icon="shield" style={{ marginBottom: 16 }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [
          styles.toggleBtn,
          { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Feather name={open ? "chevron-down" : "camera"} size={14} color={colors.mutedForeground} />
        <Text style={[styles.toggleBtnText, { color: colors.mutedForeground }]}>
          {open ? "Close" : "Check"}
        </Text>
      </Pressable>

      {open && (
        <View style={{ marginTop: 12, gap: 10 }}>
          <Text style={[styles.muted, { color: colors.mutedForeground, fontStyle: "normal" }]}>
            Photograph a finished pizza or crust for an AI quality assessment. This is advisory only
            — nothing is recorded unless you review and confirm the outcome.
          </Text>
          <View style={styles.formRow}>
            {(["pizza", "crust", "other"] as QualityProductType[]).map((t) => {
              const active = productType === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => setProductType(t)}
                  style={[
                    styles.input,
                    styles.categoryToggle,
                    {
                      flex: 1,
                      justifyContent: "center",
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary : colors.background,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? colors.primaryForeground : colors.foreground,
                      fontFamily: FONTS.medium,
                      fontSize: 12,
                      textTransform: "capitalize",
                    }}
                  >
                    {t}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            placeholder="Optional context (e.g. expected 16in, light topping)"
            placeholderTextColor={colors.mutedForeground}
            value={notes}
            onChangeText={setNotes}
            style={inputStyle}
          />
          <View style={styles.formRow}>
            <View style={{ flex: 1 }}>
              <Button label="Take photo" icon="camera" size="sm" disabled={preparing || analyzing} onPress={takePhoto} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Upload" icon="image" variant="outline" size="sm" disabled={preparing || analyzing} onPress={pickPhoto} />
            </View>
          </View>

          {(preparing || analyzing) && (
            <View style={styles.analyzingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.muted, { color: colors.mutedForeground, fontStyle: "normal" }]}>
                {preparing ? "Preparing photo…" : "Assessing…"}
              </Text>
            </View>
          )}
          {error && (
            <View style={{ gap: 6 }}>
              <Text style={[styles.muted, { color: colors.destructive }]}>{error}</Text>
              {lastImageRef.current && (
                <Button
                  label={retryIn > 0 ? `Try again in ${retryIn}s` : "Try again"}
                  icon="refresh-cw"
                  variant="outline"
                  size="sm"
                  disabled={analyzing || retryIn > 0}
                  onPress={retry}
                />
              )}
            </View>
          )}

          {result && meta && (
            <View
              style={[styles.reviewRow, { borderColor: colors.border, backgroundColor: colors.secondary }]}
            >
              <View style={styles.reviewHeader}>
                <View style={[styles.badge, { borderColor: meta.color }]}>
                  <Feather name={meta.icon} size={12} color={meta.color} />
                  <Text style={[styles.badgeText, { color: meta.color, marginLeft: 4 }]}>
                    {meta.label.toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.muted, { color: colors.mutedForeground, fontStyle: "normal" }]}>
                  {Math.round(result.assessment.confidence * 100)}% confidence
                </Text>
              </View>
              {result.assessment.summary ? (
                <Text style={{ color: colors.foreground, fontFamily: FONTS.regular, fontSize: 13 }}>
                  {result.assessment.summary}
                </Text>
              ) : null}
              {result.note ? (
                <Text style={[styles.muted, { color: colors.warning, fontStyle: "normal" }]}>
                  {result.note}
                </Text>
              ) : null}
              {result.assessment.issues.length > 0 && (
                <View style={{ gap: 4 }}>
                  {result.assessment.issues.map((iss, i) => (
                    <View key={i} style={{ flexDirection: "row", gap: 6 }}>
                      <Text
                        style={{
                          color:
                            iss.severity === "critical"
                              ? colors.destructive
                              : iss.severity === "major"
                                ? colors.warning
                                : colors.mutedForeground,
                          fontFamily: FONTS.bold,
                          fontSize: 11,
                          textTransform: "uppercase",
                        }}
                      >
                        {iss.type}
                      </Text>
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: FONTS.regular,
                          fontSize: 11,
                          flex: 1,
                        }}
                      >
                        {iss.detail}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              {confirmed ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="check-circle" size={14} color={colors.success ?? colors.primary} />
                  <Text style={{ color: colors.success ?? colors.primary, fontFamily: FONTS.medium, fontSize: 12 }}>
                    Outcome saved to facility memory.
                  </Text>
                </View>
              ) : (
                <Button
                  label={confirming ? "Saving…" : "Confirm & remember outcome"}
                  icon="check-circle"
                  variant="outline"
                  size="sm"
                  disabled={confirming}
                  onPress={confirmOutcome}
                />
              )}
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

// ── AI expiry & waste insight ────────────────────────────────────────────────
// The server flags expired/expiring-soon stock and (when anything is at risk)
// suggests a run order to consume it first. Advisory only — nothing is changed.
// Mirrors the web card.
function WasteInsightCard() {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const [result, setResult] = useState<WasteInsightResult | null>(null);

  const counting = retryIn > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setRetryIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [counting]);

  async function run() {
    setError(null);
    setRetryIn(0);
    setLoading(true);
    try {
      const res = await wasteInsight({});
      setResult(res);
    } catch (e) {
      setError(photoErrorMessage(e));
      if (e instanceof InventoryApiError && e.status === 429 && e.retryAfterSec && e.retryAfterSec > 0) {
        setRetryIn(e.retryAfterSec);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Waste Insight" icon="trash-2" style={{ marginBottom: 16 }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [
          styles.toggleBtn,
          { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Feather name={open ? "chevron-down" : "chevron-right"} size={14} color={colors.mutedForeground} />
        <Text style={[styles.toggleBtnText, { color: colors.mutedForeground }]}>
          {open ? "Close" : "Open"}
        </Text>
      </Pressable>

      {open && (
        <View style={{ marginTop: 12, gap: 10 }}>
          <Text style={[styles.muted, { color: colors.mutedForeground, fontStyle: "normal" }]}>
            Flag stock that's expired or expiring soon and get an AI suggestion for which runs to
            prioritize so it gets used first. Advisory only — nothing is rescheduled.
          </Text>
          <Button
            label={loading ? "Checking…" : retryIn > 0 ? `Try again in ${retryIn}s` : "Check expiring stock"}
            icon="trash-2"
            size="sm"
            disabled={loading || retryIn > 0}
            onPress={run}
          />

          {error && <Text style={[styles.muted, { color: colors.destructive }]}>{error}</Text>}

          {result && (
            <View style={{ gap: 8 }}>
              {result.flagged.length === 0 ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="check-circle" size={14} color={colors.success ?? colors.primary} />
                  <Text style={{ color: colors.success ?? colors.primary, fontFamily: FONTS.medium, fontSize: 12 }}>
                    Nothing is expired or expiring soon.
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
                    AT RISK ({result.flagged.length})
                  </Text>
                  <View style={{ gap: 6 }}>
                    {result.flagged.map((f) => (
                      <View
                        key={f.key}
                        style={[
                          styles.reviewRow,
                          {
                            borderColor: colors.border,
                            backgroundColor: colors.secondary,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                          },
                        ]}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
                          <View
                            style={[
                              styles.badge,
                              { borderColor: f.status === "expired" ? colors.destructive : colors.warning },
                            ]}
                          >
                            <Text
                              style={[
                                styles.badgeText,
                                { color: f.status === "expired" ? colors.destructive : colors.warning },
                              ]}
                            >
                              {f.status.toUpperCase()}
                            </Text>
                          </View>
                          <Text
                            style={{ color: colors.foreground, fontFamily: FONTS.regular, fontSize: 13, flexShrink: 1 }}
                            numberOfLines={1}
                          >
                            {f.name}
                          </Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <Feather name="clock" size={12} color={colors.mutedForeground} />
                          <Text style={{ color: colors.mutedForeground, fontFamily: FONTS.mono, fontSize: 11 }}>
                            {f.daysUntilExpiry == null
                              ? "—"
                              : f.daysUntilExpiry < 0
                                ? `${Math.abs(f.daysUntilExpiry)}d ago`
                                : `${f.daysUntilExpiry}d`}
                            {" · "}
                            {fmtQty(f.qtyAtRisk)} {f.unit}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                  {result.suggestion ? (
                    <View
                      style={[
                        styles.reviewRow,
                        { borderColor: colors.primary, backgroundColor: colors.secondary, gap: 4 },
                      ]}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Feather name="zap" size={12} color={colors.primary} />
                        <Text style={[styles.detailLabel, { color: colors.primary }]}>
                          SUGGESTED RUN ORDER
                        </Text>
                      </View>
                      <Text style={{ color: colors.foreground, fontFamily: FONTS.regular, fontSize: 13 }}>
                        {result.suggestion}
                      </Text>
                    </View>
                  ) : null}
                  {result.note ? (
                    <Text style={[styles.muted, { color: colors.warning, fontStyle: "normal" }]}>
                      {result.note}
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },

  muted: { fontSize: 13, fontStyle: "italic", fontFamily: FONTS.regular },
  tinyMuted: { fontSize: 11, marginTop: 4, fontFamily: FONTS.regular },
  emptyCenter: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 24,
    fontFamily: FONTS.regular,
  },

  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  alertText: { fontSize: 13, flexShrink: 1, fontFamily: FONTS.regular },
  alertValue: { fontSize: 13, fontFamily: FONTS.medium, flexShrink: 0 },
  subPrefillBtn: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  subPrefillText: { fontSize: 13, flexShrink: 1, fontFamily: FONTS.regular, textDecorationLine: "underline" },

  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  settingsLabel: { fontSize: 13, flexShrink: 1, fontFamily: FONTS.regular },
  settingsInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 64,
    textAlign: "right",
    fontSize: 14,
    fontFamily: FONTS.medium,
  },
  settingsHint: { fontSize: 11, marginTop: 6, fontFamily: FONTS.regular },

  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  toggleBtnText: { fontSize: 12, fontFamily: FONTS.medium },

  itemRow: { borderRadius: 8, borderWidth: 1 },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  itemHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 },
  itemName: { fontSize: 14, fontFamily: FONTS.medium, flexShrink: 1 },
  lowBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  lowBadgeText: { fontSize: 9, fontFamily: FONTS.bold },
  itemQty: {
    fontSize: 14,
    fontFamily: FONTS.monoBold,
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
  },
  itemUnit: { fontFamily: FONTS.regular },

  detail: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 12, borderTopWidth: 1, gap: 12 },
  detailLabel: { fontSize: 11, fontFamily: FONTS.medium, marginBottom: 4, letterSpacing: 0.5 },
  detailInline: { fontSize: 13, fontFamily: FONTS.regular },

  lotRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  lotText: { fontSize: 12, flexShrink: 1, fontFamily: FONTS.regular },
  lotQty: {
    fontSize: 12,
    fontFamily: FONTS.mono,
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
  },

  thresholdRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  thresholdEdit: { flexDirection: "row", alignItems: "center", gap: 6 },
  thresholdView: { flexDirection: "row", alignItems: "center", gap: 4 },
  thresholdValText: {
    fontSize: 13,
    fontFamily: FONTS.mono,
    fontVariant: ["tabular-nums"],
  },

  sep: { height: 1 },

  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    fontFamily: FONTS.regular,
  },
  inputSm: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    width: 80,
    fontFamily: FONTS.regular,
  },
  formRow: { flexDirection: "row", gap: 6 },
  categoryToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  historyToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  historyToggleText: { fontSize: 12, fontFamily: FONTS.medium },

  modeRow: { flexDirection: "row", gap: 6 },
  modeBtn: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modeBtnText: { fontSize: 12, fontFamily: FONTS.medium },

  candidateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
  },
  candidateText: { fontSize: 13, fontFamily: FONTS.regular, flexShrink: 1 },

  analyzingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  reviewRow: { borderRadius: 8, borderWidth: 1, padding: 10, gap: 6 },
  reviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  reviewBadges: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  badge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  badgeText: { fontSize: 9, fontFamily: FONTS.bold },
  matchChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  matchChip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  matchChipText: { fontSize: 11, fontFamily: FONTS.medium },
});
