import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack } from "expo-router";
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CardSection, SectionHeader } from "@/components/UI";
import { useRun, type MasterListKey } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";

function tap() {
  Haptics.selectionAsync();
}

function ListManager({
  items,
  onAdd,
  onRemove,
  onRename,
  placeholder,
  hideAdd,
}: {
  items: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  onRename?: (oldName: string, newName: string) => void;
  placeholder: string;
  hideAdd?: boolean;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onAdd(v);
    setDraft("");
    tap();
  };

  const startEdit = (item: string) => {
    setEditing(item);
    setEditDraft(item);
    tap();
  };

  const commitEdit = () => {
    if (editing != null) {
      const v = editDraft.trim();
      if (v && v !== editing) onRename?.(editing, v);
    }
    setEditing(null);
    setEditDraft("");
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.chipWrap}>
        {items.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            None yet — add one below.
          </Text>
        ) : (
          items.map((item) =>
            editing === item ? (
              <View key={item} style={styles.editRow}>
                <TextInput
                  style={[
                    styles.editInput,
                    { color: colors.foreground, borderColor: colors.primary },
                  ]}
                  value={editDraft}
                  onChangeText={setEditDraft}
                  autoFocus
                  autoCapitalize="words"
                  onSubmitEditing={commitEdit}
                  returnKeyType="done"
                />
                <Pressable onPress={commitEdit} hitSlop={6} style={styles.editIconBtn}>
                  <Feather name="check" size={16} color={colors.primary} />
                </Pressable>
                <Pressable
                  onPress={() => {
                    setEditing(null);
                    setEditDraft("");
                  }}
                  hitSlop={6}
                  style={styles.editIconBtn}
                >
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ) : (
              <View
                key={item}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: colors.secondary },
                ]}
              >
                {onRename ? (
                  <Pressable onPress={() => startEdit(item)} hitSlop={4}>
                    <Text style={[styles.chipText, { color: colors.foreground }]}>
                      {item}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={[styles.chipText, { color: colors.foreground }]}>
                    {item}
                  </Text>
                )}
                <Pressable
                  onPress={() => {
                    onRemove(item);
                    tap();
                  }}
                  hitSlop={6}
                >
                  <Feather name="x" size={13} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ),
          )
        )}
      </View>
      {hideAdd ? null : (
        <View style={styles.addRow}>
          <TextInput
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border },
            ]}
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            onSubmitEditing={add}
            returnKeyType="done"
          />
          <Pressable
            onPress={add}
            disabled={!draft.trim()}
            style={({ pressed }) => [
              styles.addBtn,
              {
                backgroundColor: colors.primary,
                opacity: !draft.trim() ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="plus" size={18} color={colors.primaryForeground} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function MasterDataScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    brands,
    brandFlavors,
    dieTypes,
    pepTypes,
    cheeseIngredients,
    doughIngredients,
    frontlineIngredients,
    stopReasons,
    addListItem,
    removeListItem,
    renameListItem,
    renameBrand,
    addFlavor,
    removeFlavor,
    renameFlavor,
    mixRecipePresets,
    deleteRecipePreset,
    renameRecipePreset,
    supervisorPin,
    setSupervisorPin,
  } = useRun();

  const [pinDraft, setPinDraft] = useState("");
  const mixNames = Object.keys(mixRecipePresets);

  const simpleList = (key: MasterListKey) => ({
    onAdd: (v: string) => addListItem(key, v),
    onRemove: (v: string) => removeListItem(key, v),
    onRename: (oldName: string, newName: string) =>
      renameListItem(key, oldName, newName),
  });

  const webTop = Platform.OS === "web" ? 16 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  return (
    <>
      <Stack.Screen options={{ title: "Master Data", headerShown: true }} />
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{
          padding: 16,
          paddingTop: webTop + 8,
          paddingBottom: insets.bottom + webBottom + 48,
          gap: 4,
        }}
      >
        {/* Brands & flavors */}
        <SectionHeader title="Brands & Flavors" />
        <CardSection>
          <ListManager
            items={brands}
            placeholder="Add brand…"
            onAdd={(v) => addListItem("brands", v)}
            onRemove={(v) => removeListItem("brands", v)}
            onRename={renameBrand}
          />
          {brands.map((brand) => (
            <View key={brand} style={styles.brandBlock}>
              <Text style={[styles.brandName, { color: colors.foreground }]}>
                {brand}
              </Text>
              <ListManager
                items={brandFlavors[brand] ?? []}
                placeholder={`Add flavor for ${brand}…`}
                onAdd={(v) => addFlavor(brand, v)}
                onRemove={(v) => removeFlavor(brand, v)}
                onRename={(oldF, newF) => renameFlavor(brand, oldF, newF)}
              />
            </View>
          ))}
        </CardSection>

        {/* Die types */}
        <SectionHeader title="Die Types" />
        <CardSection>
          <ListManager
            items={dieTypes}
            placeholder="Add die type…"
            {...simpleList("dieTypes")}
          />
        </CardSection>

        {/* Pepperoni types */}
        <SectionHeader title="Pepperoni Types" />
        <CardSection>
          <ListManager
            items={pepTypes}
            placeholder="Add pepperoni type…"
            {...simpleList("pepTypes")}
          />
        </CardSection>

        {/* Cheese ingredients */}
        <SectionHeader title="Cheese Ingredients" />
        <CardSection>
          <ListManager
            items={cheeseIngredients}
            placeholder="Add cheese ingredient…"
            {...simpleList("cheeseIngredients")}
          />
        </CardSection>

        {/* Dough ingredients */}
        <SectionHeader title="Dough Ingredients" />
        <CardSection>
          <ListManager
            items={doughIngredients}
            placeholder="Add dough ingredient…"
            {...simpleList("doughIngredients")}
          />
        </CardSection>

        {/* Frontline ingredients */}
        <SectionHeader title="Frontline Ingredients" />
        <CardSection>
          <ListManager
            items={frontlineIngredients}
            placeholder="Add frontline ingredient…"
            {...simpleList("frontlineIngredients")}
          />
        </CardSection>

        {/* Stop reasons */}
        <SectionHeader title="Stop Reasons" />
        <CardSection>
          <ListManager
            items={stopReasons}
            placeholder="Add stop reason…"
            {...simpleList("stopReasons")}
          />
        </CardSection>

        {/* My mix recipes */}
        <SectionHeader title="My Mix Recipes" />
        <CardSection>
          <Text style={[styles.pinHint, { color: colors.mutedForeground }]}>
            Saved from the Setup tab&apos;s mix editor. Tap a name to rename.
          </Text>
          {mixNames.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              None yet — save one with “Save as mix” in the Setup tab.
            </Text>
          ) : (
            <ListManager
              items={mixNames}
              placeholder=""
              hideAdd
              onAdd={() => {}}
              onRemove={(v) => deleteRecipePreset("mix", v)}
              onRename={(oldName, newName) =>
                renameRecipePreset("mix", oldName, newName)
              }
            />
          )}
        </CardSection>

        {/* Supervisor PIN */}
        <SectionHeader title="Supervisor PIN" />
        <CardSection>
          <Text style={[styles.pinHint, { color: colors.mutedForeground }]}>
            {supervisorPin
              ? "A PIN is set. Enter a new one to change it, or clear it."
              : "No PIN set. The Setup tab is unlocked."}
          </Text>
          <View style={styles.addRow}>
            <TextInput
              style={[
                styles.input,
                { color: colors.foreground, borderColor: colors.border },
              ]}
              value={pinDraft}
              onChangeText={setPinDraft}
              placeholder="New PIN (digits)"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={8}
            />
            <Pressable
              onPress={() => {
                setSupervisorPin(pinDraft.trim());
                setPinDraft("");
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success,
                );
              }}
              disabled={!pinDraft.trim()}
              style={({ pressed }) => [
                styles.pinSaveBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: !pinDraft.trim() ? 0.4 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[styles.pinSaveText, { color: colors.primaryForeground }]}
              >
                Set
              </Text>
            </Pressable>
          </View>
          {supervisorPin ? (
            <Pressable
              onPress={() => {
                setSupervisorPin("");
                tap();
              }}
              style={({ pressed }) => [
                styles.clearPinBtn,
                { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Feather name="unlock" size={14} color={colors.foreground} />
              <Text style={[styles.clearPinText, { color: colors.foreground }]}>
                Remove PIN lock
              </Text>
            </Pressable>
          ) : null}
        </CardSection>
      </KeyboardAwareScrollViewCompat>
    </>
  );
}

const styles = StyleSheet.create({
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  empty: { fontSize: 13, fontStyle: "italic" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 13, fontFamily: FONTS.medium },
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexGrow: 1,
    flexBasis: "100%",
  },
  editInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
    fontFamily: FONTS.regular,
  },
  editIconBtn: { padding: 6 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: FONTS.regular,
  },
  addBtn: {
    width: 44,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  brandBlock: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(127,127,127,0.3)",
    gap: 8,
  },
  brandName: { fontSize: 15, fontFamily: FONTS.bold },
  pinHint: { fontSize: 12, marginBottom: 10 },
  pinSaveBtn: {
    paddingHorizontal: 18,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  pinSaveText: { fontSize: 14, fontFamily: FONTS.semibold },
  clearPinBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    marginTop: 12,
  },
  clearPinText: { fontSize: 13, fontFamily: FONTS.semibold },
});
