# MTGA Tracker - Enhancement Roadmap

## Overview
Polish and enhance the MTGA Tracker with new features, better data utilization, and improved UX.

## Quick Wins

Small changes with immediate impact. Data already exists, just needs UI.

### 1. Display Sideboard in Overlay
- **Files:** `renderer/overlay/overlay.ts`, `overlay.css`
- **Status:** Sideboard parsed in `DeckSubmissionData` but never rendered
- **Task:** Add collapsible sideboard section below main deck

### 2. Show Booster & Token Counts
- **Files:** `renderer/dashboard/dashboard.ts`
- **Status:** `inventory.boosters`, `draftTokens`, `sealedTokens` parsed but hidden
- **Task:** Add to inventory section in dashboard

### 3. On-Play/Draw Win Rate
- **Files:** `main/data/database.ts`, `renderer/dashboard/dashboard.ts`
- **Status:** Database has `on_play` boolean field
- **Task:** Calculate and display separate win rates for play vs draw

### 4. Turn Counter in Overlay
- **Files:** `renderer/overlay/overlay.ts`
- **Status:** `turnNumber` parsed in game-state.ts but unused
- **Task:** Show current turn in overlay header during match

### 5. Format-Specific Stats in Dashboard
- **Files:** `renderer/dashboard/dashboard.ts`
- **Status:** Format stored per match but stats are aggregated
- **Task:** Add format breakdown in stats section

## Medium Features

Moderate complexity, high value additions.

### 6. Opponent Tracking & Meta Analysis
- **Files:** `main/data/database.ts`, `renderer/dashboard/dashboard.ts`
- **Status:** Opponent name stored but never analyzed
- **Task:** New dashboard tab showing:
  - Most played opponents
  - Win rate per opponent
  - Opponent deck patterns

### 7. Collection Viewer
- **Files:** `renderer/dashboard/dashboard.ts`, `main/data/database.ts`
- **Status:** Full collection stored in `collection` table, no UI
- **Task:** New dashboard section showing:
  - Collection completion % by set
  - Rarity breakdown
  - Missing cards for deck building

### 8. Advanced Match Filtering
- **Files:** `renderer/dashboard/dashboard.ts`
- **Status:** Basic format/result filters exist
- **Task:** Add:
  - Date range picker
  - Multi-select filters
  - Deck name search
  - Combined filters

### 9. Match Notes
- **Files:** `main/data/database.ts`, `renderer/dashboard/dashboard.ts`
- **Status:** No notes capability
- **Task:**
  - Add `notes` column to matches table
  - Add editable notes field in match history
  - Useful for recording mulligan decisions, key plays

### 10. Export Match History
- **Files:** `renderer/dashboard/dashboard.ts`
- **Status:** Data locked in SQLite
- **Task:** Add export buttons for:
  - CSV (for spreadsheets)
  - JSON (for external tools)
  - Filtered exports

### 11. Keyboard Shortcuts
- **Files:** `renderer/overlay/overlay.ts`, `renderer/dashboard/dashboard.ts`
- **Task:** Add shortcuts for:
  - Toggle overlay minimize (e.g., Ctrl+M)
  - Refresh dashboard (e.g., Ctrl+R)
  - Switch dashboard tabs

## Larger Features

Significant effort, major UX improvements.

### 12. Card Image Previews
- **Files:** All renderer files, `main/data/card-registry.ts`
- **Status:** `imageUrl` field exists in card registry
- **Task:**
  - Add card art to tooltips on hover
  - Consider image caching strategy
  - May need layout redesign for overlay

### 13. Performance Charts & Trends
- **Files:** `renderer/dashboard/dashboard.ts`
- **Dependencies:** Chart.js or similar library
- **Task:**
  - Win rate over time graph
  - Format performance comparison
  - Deck performance trends
  - Session statistics

### 14. Deck Archetype Management
- **Files:** `main/data/database.ts`, `renderer/dashboard/dashboard.ts`
- **Status:** Deck names are raw strings, no organization
- **Task:**
  - Allow renaming decks
  - Tag decks with archetypes (Aggro, Control, Midrange, Combo)
  - Link deck variants together
  - Track performance by archetype

### 15. Opponent Board Tracking
- **Files:** `main/parser/game-state.ts`, `renderer/overlay/overlay.ts`
- **Status:** Zone data for seat 2 (opponent) is parsed but filtered out
- **Task:**
  - Parse opponent battlefield
  - Show opponent's visible cards
  - Track opponent's graveyard

### 16. Deck Import/Export
- **Files:** New utility module
- **Task:**
  - Export to Arena format
  - Export to Moxfield/Archidekt format
  - Import from text paste

## Code Quality

Technical debt and improvements.

### Extract Format Detection Utility
- **Files:** `main/parser/match-parser.ts`, `renderer/dashboard/dashboard.ts`
- **Issue:** Format regex patterns duplicated
- **Task:** Create shared `formatUtils.ts`

### Fix Opponent Rank Parsing
- **Files:** `main/parser/match-parser.ts`
- **Issue:** `opponentRank` always empty string
- **Task:** Investigate actual log format, fix extraction

### Improve Position Save Reliability
- **Files:** `main/windows/overlay.ts`
- **Issue:** Debounced save could miss final position on crash
- **Task:** Add `beforeunload` handler for immediate save

### Add Error Boundaries for Card Lookups
- **Files:** `renderer/overlay/overlay.ts`
- **Issue:** Missing card data fails silently
- **Task:** Add fallback UI when card registry lookup fails

## Architecture Notes

```
Electron Main Process
├── Log Watcher (chokidar) → watches Player.log
├── Log Parser (Node.js) → extracts JSON events
├── Data Store (SQLite) → match history, collection, decks
└── Card Registry → shared Scryfall data with grpId mapping

Windows
├── Overlay Window (transparent, always-on-top) → deck tracker
└── Dashboard Window → match history, stats, collection
```

## Key Log Patterns

**Log Location (macOS):**
```
~/Library/Logs/Wizards Of The Coast/MTGA/Player.log
```

**Important Log Events:**
- `InventoryInfo` → gems, gold, wildcards, collection
- `GreToClientEvent` → game state, card draws, plays
- `MatchGameRoomStateChangedEvent` → match start/end
- `DeckSubmit` / `Event_SetDeck` → deck selection
- Uses `grpId` (Arena card IDs) mapped to Scryfall data
