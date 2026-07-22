#!/usr/bin/env python3
"""
Transform home.tsx: isolate 1-second clock into LiveRunContext.
Extracts ALL clock-dependent tab contents into sub-components.
Auto-generates homeCtxValue and COMMON_HX from discovered Home scope vars.
Applies ': any' to lambda params in extracted content to satisfy noImplicitAny.
"""
import re

# ── Read original ──────────────────────────────────────────────────────────────
with open('artifacts/run-calculator/src/pages/home.tsx', 'r') as f:
    orig = f.readlines()
lines = list(orig)

def extract(start1, end1):
    """Lines start1..end1 (1-indexed, inclusive) from ORIGINAL."""
    return ''.join(orig[start1 - 1 : end1])

# ── Auto-discover Home-scope variables ─────────────────────────────────────────
# Collect identifiers declared at top level of Home() (exactly 2-space indent).
# We scan the whole Home body as a string to handle MULTI-LINE destructurings.
HOME_START = 2407   # 0-indexed: line 2408 = 'export default function Home() {'
HOME_END   = 11222  # 0-indexed: line 11223 = '  return ('
home_body = ''.join(orig[HOME_START:HOME_END])

home_scope = set()

# 1. Simple declarations: const/let/var/function/async function name at 2-space indent
decl_re  = re.compile(r'^  (?:(?:const|let|var)\s+|(?:async\s+)?function\s+)([a-zA-Z_]\w*)', re.MULTILINE)
for m in decl_re.finditer(home_body):
    home_scope.add(m.group(1))

# 2. Object destructuring blocks (handles single-line AND multi-line):
#    const { a, b,\n    c } = ...
destr_re = re.compile(r'^  (?:const|let|var)\s*\{([^}]+)\}', re.MULTILINE)
for m in destr_re.finditer(home_body):
    for part in re.split(r'[,\n]+', m.group(1)):
        part = part.strip()
        if not part:
            continue
        # Handle 'alias: localName' → take localName; else take name
        if ':' in part and '?' not in part[:part.index(':')]:
            local = part.split(':')[-1].strip()
        else:
            local = part.split(':')[0].strip()
        local = re.split(r'[\s=]', local)[0].strip()
        if re.match(r'^[a-zA-Z_]\w*$', local):
            home_scope.add(local)

# 3. Array destructuring (useState, useReducer, etc.):
#    const [a, b] = useState(...)  OR  const [a, b,\n    c] = ...
arr_destr_re = re.compile(r'^  (?:const|let|var)\s*\[([^\]]+)\]', re.MULTILINE)
for m in arr_destr_re.finditer(home_body):
    for part in re.split(r'[,\n]+', m.group(1)):
        part = part.strip()
        if not part:
            continue
        local = re.split(r'[\s=]', part)[0].strip()
        if re.match(r'^[a-zA-Z_]\w*$', local):
            home_scope.add(local)

KEYWORDS = {
    'if','else','for','while','do','switch','case','break','continue','return',
    'try','catch','finally','throw','new','delete','typeof','instanceof','void',
    'const','let','var','function','class','extends','import','export','default',
    'from','in','of','true','false','null','undefined','async','await','super',
}
home_scope = {x for x in home_scope if x not in KEYWORDS}

# Clock variables DELETED from Home (moved to LiveRunContext).
# Note: autoSuppressUntilRef is NOT in this list — we keep it in Home.
CLOCK_VARS = {
    'nowTime', 'liveFreezerMin', 'calc',
    'casesPct', 'casesFreezerPct', 'casesPctWithFreezer',
    'elapsedBatchSec', 'currentRunDowntimeMs',
    'currentBatchNum', 'secUntilNextBatch', 'totalBatchesNeeded',
    'autoTrackProgress', 'setAutoTrackProgress', 'autoTrackSuggestion',
    'fireAutoTrackNow', 'tickDueRefs',
    'stallPrompt', 'setStallPrompt', 'showBatchDue', 'setShowBatchDue',
    # Additional vars from deleted stall-detection + pre-seed blocks
    'stallCheck', 'stallEpisodeShownRef', 'nextRunSeededRef',
}
home_live_vars = home_scope - CLOCK_VARS
# autoSuppressUntilRef is found in original (from useAutoTrack destructuring)
# and NOT in CLOCK_VARS, so it remains in home_live_vars. We add it back
# to Home as a standalone useRef(0) declaration. ✓

# Build sorted var list for deterministic output
sorted_vars = sorted(home_live_vars)

def chunk_vars(lst, n=6):
    for i in range(0, len(lst), n):
        yield lst[i:i+n]

ctx_lines = []
for chunk in chunk_vars(sorted_vars):
    ctx_lines.append('    ' + ', '.join(chunk) + ',\n')
HOME_CTX_BODY = ''.join(ctx_lines)

# ── Lambda type annotation fix ─────────────────────────────────────────────────
def fix_lambda_any(s):
    """Add ': any' to arrow function params that lack explicit type annotations.
    Applied to extracted content so noImplicitAny doesn't fire on any-typed arrays."""
    # Three-param first (avoid partial match by two-param)
    s = re.sub(
        r'\(([a-zA-Z_]\w*)(?!\s*[?:]),\s*([a-zA-Z_]\w*)(?!\s*[?:]),\s*'
        r'([a-zA-Z_]\w*)(?!\s*[?:])\)\s*(=>)',
        r'(\1: any, \2: any, \3: any) \4', s)
    # Two-param
    s = re.sub(
        r'\(([a-zA-Z_]\w*)(?!\s*[?:]),\s*([a-zA-Z_]\w*)(?!\s*[?:])\)\s*(=>)',
        r'(\1: any, \2: any) \3', s)
    # One-param with parens
    s = re.sub(r'\(([a-zA-Z_]\w*)(?!\s*[?:])\)\s*(=>)', r'(\1: any) \2', s)
    # No-paren single-param in any function call: fn(word => ...
    # Handles both array methods and state setter updaters (e.g. setState(o => !o))
    s = re.sub(
        r'(\w+\s*\(\s*)([a-zA-Z_]\w*)(?!\s*[?:])\s*(=>)',
        r'\1(\2: any) \3', s)
    return s

# ── Pre-extract JSX content from original (before modification) ────────────────
floor_mode_body   = fix_lambda_any(extract(11267, 11501))
glance_body       = fix_lambda_any(extract(11506, 11561))
compact_strip_jsx = fix_lambda_any(extract(12720, 12869))
screen_modes      = fix_lambda_any(extract(10576, 11222))

run_tab_content        = fix_lambda_any(extract(13140, 14486))
packaging_tab_content  = fix_lambda_any(extract(14653, 15128))
frontline_tab_content  = fix_lambda_any(extract(15153, 15277))
dough_tab_content      = fix_lambda_any(extract(15941, 16607))
setup2_tab_content     = fix_lambda_any(extract(16612, 17303))
stoppages_tab_content  = fix_lambda_any(extract(17308, 17473))
summary_tab_content    = fix_lambda_any(extract(17478, 18151))

# ── Modify lines[] in place ────────────────────────────────────────────────────

# 1. Add createContext + useContext to React import (line 1, index 0)
lines[0] = (lines[0]
    .replace('import { useCallback,', 'import { createContext, useCallback,')
    .replace('useRef, useState }', 'useRef, useState, useContext }'))

# 2. Remove detectStallFromDelta import (line 265, index 264)
lines[264] = ''

# 3. Remove useClock import (line 325, index 324)
lines[324] = ''

# 4. Keep suggestedDoughStaging but drop useAutoTrack hook (line 327, index 326)
lines[326] = 'import { suggestedDoughStaging } from "../hooks/useAutoTrack";\n'

# 5. Replace useNotifications import with LiveRunContext + calcRef import (line 328, index 327)
lines[327] = 'import { useLiveRun, LiveRunProvider, calcRef } from "../contexts/LiveRunContext";\n'

# 6. Insert HomeCtx before Home function (line 2408, index 2407)
lines[2407] = (
    '// ─── HomeCtx: stable (non-clock) data shared to extracted sub-components ───\n'
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any\n'
    'const HomeCtx = createContext<any>(null);\n'
    'function useHomeCtx(): any {\n'
    '  const ctx = useContext(HomeCtx);\n'
    '  if (!ctx) throw new Error("useHomeCtx must be used within HomeCtx.Provider");\n'
    '  return ctx;\n'
    '}\n'
    '\n'
    + lines[2407]
)

# 7. Insert standalone autoSuppressUntilRef right after useAuth (index 2418, line 2419)
#    Must be BEFORE its usages in Home body (e.g. line 8542).
lines[2418] = (
    '  // Shared auto-track suppress ref — owned in Home, passed to LiveRunProvider\n'
    '  // so both Home callbacks and useAutoTrack suppress the same latch.\n'
    '  const autoSuppressUntilRef = useRef<number>(0);\n'
    + lines[2418]
)

# 8. Fix calc.totalTimeSec in startRun (line 8117, index 8116)
#    calcRef is a module-level ref kept in sync by LiveRunProvider each render.
lines[8116] = lines[8116].replace(
    'calc.totalTimeSec * 1000',
    '(calcRef.current?.totalTimeSec ?? 0) * 1000'
)

# 9. Remove nowTime + blank (lines 9844-9845, indices 9843-9844)
lines[9843] = ''
lines[9844] = ''

# 10. Remove liveFreezerMin IIFE (lines 9851-9858, indices 9850-9857)
for i in range(9850, 9858):
    lines[i] = ''

# 11. Remove calc useMemo block (lines 10084-10380, indices 10083-10379)
for i in range(10083, 10380):
    lines[i] = ''

# 12. Remove useNotifications call (lines 10421-10431, indices 10420-10430)
for i in range(10420, 10431):
    lines[i] = ''

# 13. Remove stall detection + effects (lines 10432-10465, indices 10431-10464)
for i in range(10431, 10465):
    lines[i] = ''

# 14. Remove casesPct / elapsedBatchSec / useAutoTrack / pre-seed / batchNums
#     (lines 10477-10575, indices 10476-10574)
for i in range(10476, 10575):
    lines[i] = ''

# 15. Remove 7 screen mode early returns (lines 10576-11223, indices 10575-11222)
for i in range(10575, 11223):
    lines[i] = ''

# 16. Before return: insert homeCtxValue assembly + change return→const mainContent
#     Original line 11224 (index 11223): "  return ("
lines[11223] = (
    '\n'
    '  // ── Stable context value for extracted sub-components ──────────────────\n'
    '  const homeCtxValue = {\n'
    + HOME_CTX_BODY +
    '  };\n'
    '\n'
    '  const mainContent = (\n'
)

# 17. End of Home: close mainContent + real return with providers
#     Original line 19546 (index 19545): "  );"
#     Original line 19547 (index 19546): "}"
lines[19545] = (
    '  );\n'
    '\n'
    '  return (\n'
    '    <HomeCtx.Provider value={homeCtxValue}>\n'
    '      <LiveRunProvider\n'
    '        v={v}\n'
    '        ve={ve}\n'
    '        runStatus={runStatus}\n'
    '        currentRun={currentRun}\n'
    '        currentRunId={currentRunId}\n'
    '        form={form}\n'
    '        dayState={dayState}\n'
    '        doughSubTab={doughSubTab}\n'
    '        upcomingRunLabels={upcomingRunLabels}\n'
    '        prefs={me?.notificationPrefs}\n'
    '        screenMode={screenMode}\n'
    '        externalAutoSuppressRef={autoSuppressUntilRef}\n'
    '        machine={{\n'
    '          spinSec: (Number(v.mixerLowSec) || 0) + (Number(v.mixerHighSec) || 0),\n'
    '          hopperSec: Number(v.hopperSec) || 0,\n'
    '        }}\n'
    '      >\n'
    '        {screenMode ? <ScreenModeView /> : mainContent}\n'
    '      </LiveRunProvider>\n'
    '    </HomeCtx.Provider>\n'
    '  );\n'
)
lines[19546] = '}\n'

# ─── Replace IIFEs / tab content with component calls ─────────────────────────

# 18. Floor mode IIFE (lines 11265-11502)
lines[11264] = '      {/* ── Floor Mode overlay ──────────────────────────────────────────── */}\n'
lines[11265] = '      {showFloorMode && <FloorModeView />}\n'
for i in range(11266, 11502):
    lines[i] = ''

# 19. Glance overlay IIFE (lines 11504-11562)
lines[11503] = '      {/* ── Glance overlay ──────────────────────────────────────────────── */}\n'
lines[11504] = '      {showGlance && <GlanceOverlay />}\n'
for i in range(11505, 11562):
    lines[i] = ''

# 20. Compact run strip (lines 12719-12871)
lines[12718] = '        {activeTab !== "run" && <CompactRunStrip />}\n'
for i in range(12719, 12871):
    lines[i] = ''

# 21. Run tab content (lines 13139-14487)
lines[13139] = '                <LiveRunTabContent />\n'
for i in range(13140, 14486):
    lines[i] = ''

# 22. Packaging tab content (lines 14652-15129)
lines[14652] = '                <LivePackagingTabContent />\n'
for i in range(14653, 15128):
    lines[i] = ''

# 23. Frontline tab content (lines 15152-15278)
lines[15152] = '                <LiveFrontlineTabContent />\n'
for i in range(15153, 15277):
    lines[i] = ''

# 24. Dough tab content (lines 15940-16608)
lines[15940] = '                <LiveDoughTabContent />\n'
for i in range(15941, 16607):
    lines[i] = ''

# 25. Setup/recipe-editors tab content (lines 16611-17304)
lines[16611] = '                <LiveSetupRecipesTabContent />\n'
for i in range(16612, 17303):
    lines[i] = ''

# 26. Stoppages tab content (lines 17307-17474)
lines[17307] = '                <LiveStoppagesTabContent />\n'
for i in range(17308, 17473):
    lines[i] = ''

# 27. Summary tab content (lines 17477-18152)
lines[17477] = '                <LiveSummaryTabContent />\n'
for i in range(17478, 18151):
    lines[i] = ''

# ─── Build appended component definitions ─────────────────────────────────────

# COMMON_HX: all 289 non-clock Home scope vars (auto-generated)
COMMON_HX = (
    '  const hx = useHomeCtx();\n'
    '  // eslint-disable-next-line @typescript-eslint/no-unused-vars\n'
    '  const {\n'
    + HOME_CTX_BODY +
    '  } = hx;\n'
)

# COMMON_LIVE: all clock-derived values from LiveRunContext
# Note: autoSuppressUntilRef is omitted here — it comes from COMMON_HX (home scope)
COMMON_LIVE = (
    '  const {\n'
    '    calc, nowTime, liveFreezerMin, elapsedBatchSec, currentRunDowntimeMs,\n'
    '    casesPct, casesFreezerPct, casesPctWithFreezer,\n'
    '    currentBatchNum, secUntilNextBatch, totalBatchesNeeded,\n'
    '    showBatchDue, setShowBatchDue,\n'
    '    autoTrackProgress, setAutoTrackProgress, autoTrackSuggestion,\n'
    '    fireAutoTrackNow, tickDueRefs,\n'
    '    stallPrompt, setStallPrompt, stallCheck,\n'
    '  } = useLiveRun();\n'
)

SCREEN_MODE_VIEW = (
    '\n'
    '// ═══════════════════════════════════════════════════════════════════════════\n'
    '// Extracted sub-components — co-located with Home; use useHomeCtx()+useLiveRun()\n'
    '// ═══════════════════════════════════════════════════════════════════════════\n'
    '\n'
    'function ScreenModeView() {\n'
    + COMMON_HX + '\n'
    + COMMON_LIVE + '\n'
    + screen_modes.rstrip('\n') +
    '\n\n'
    '  return null;\n'
    '}\n'
)

FLOOR_MODE_VIEW = (
    '\n'
    'function FloorModeView() {\n'
    + COMMON_HX + '\n'
    + COMMON_LIVE + '\n'
    + floor_mode_body +
    '}\n'
)

GLANCE_OVERLAY = (
    '\n'
    'function GlanceOverlay() {\n'
    + COMMON_HX + '\n'
    '  const { calc, nowTime, casesFreezerPct } = useLiveRun();\n'
    + glance_body +
    '}\n'
)

COMPACT_RUN_STRIP = (
    '\n'
    'function CompactRunStrip() {\n'
    + COMMON_HX + '\n'
    '  const {\n'
    '    calc, nowTime, liveFreezerMin, elapsedBatchSec, casesPct, casesFreezerPct,\n'
    '    casesPctWithFreezer, currentRunDowntimeMs, currentBatchNum, secUntilNextBatch,\n'
    '  } = useLiveRun();\n'
    '  return (\n'
    + compact_strip_jsx +
    '  );\n'
    '}\n'
)

LIVE_RUN_TAB = (
    '\n'
    'function LiveRunTabContent() {\n'
    + COMMON_HX + '\n'
    + COMMON_LIVE + '\n'
    '  return (\n'
    '    <>\n'
    + run_tab_content +
    '    </>\n'
    '  );\n'
    '}\n'
)

LIVE_PACKAGING_TAB = (
    '\n'
    'function LivePackagingTabContent() {\n'
    + COMMON_HX + '\n'
    + COMMON_LIVE + '\n'
    '  return (\n'
    '    <>\n'
    + packaging_tab_content +
    '    </>\n'
    '  );\n'
    '}\n'
)

LIVE_FRONTLINE_TAB = (
    '\n'
    'function LiveFrontlineTabContent() {\n'
    + COMMON_HX + '\n'
    '  const { calc } = useLiveRun();\n'
    '  return (\n'
    '    <>\n'
    + frontline_tab_content +
    '    </>\n'
    '  );\n'
    '}\n'
)

LIVE_DOUGH_TAB = (
    '\n'
    'function LiveDoughTabContent() {\n'
    + COMMON_HX + '\n'
    + COMMON_LIVE + '\n'
    '  return (\n'
    '    <>\n'
    + dough_tab_content +
    '    </>\n'
    '  );\n'
    '}\n'
)

LIVE_SETUP2_TAB = (
    '\n'
    'function LiveSetupRecipesTabContent() {\n'
    + COMMON_HX + '\n'
    '  const { calc } = useLiveRun();\n'
    '  return (\n'
    '    <>\n'
    + setup2_tab_content +
    '    </>\n'
    '  );\n'
    '}\n'
)

LIVE_STOPPAGES_TAB = (
    '\n'
    'function LiveStoppagesTabContent() {\n'
    + COMMON_HX + '\n'
    '  const { nowTime } = useLiveRun();\n'
    '  return (\n'
    '    <>\n'
    + stoppages_tab_content +
    '    </>\n'
    '  );\n'
    '}\n'
)

LIVE_SUMMARY_TAB = (
    '\n'
    'function LiveSummaryTabContent() {\n'
    + COMMON_HX + '\n'
    '  const { calc, liveFreezerMin } = useLiveRun();\n'
    '  return (\n'
    '    <>\n'
    + summary_tab_content +
    '    </>\n'
    '  );\n'
    '}\n'
)

# ─── Write output ─────────────────────────────────────────────────────────────
result = ''.join(lines)
result += SCREEN_MODE_VIEW
result += FLOOR_MODE_VIEW
result += GLANCE_OVERLAY
result += COMPACT_RUN_STRIP
result += LIVE_RUN_TAB
result += LIVE_PACKAGING_TAB
result += LIVE_FRONTLINE_TAB
result += LIVE_DOUGH_TAB
result += LIVE_SETUP2_TAB
result += LIVE_STOPPAGES_TAB
result += LIVE_SUMMARY_TAB

with open('artifacts/run-calculator/src/pages/home.tsx', 'w') as f:
    f.write(result)

print(f"Done! {result.count(chr(10))} lines.")
print(f"Home scope vars (non-clock): {len(home_live_vars)}")
