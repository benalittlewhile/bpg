# Turn-Based RPG Effect System - Conceptual Design

## Table of Contents
1. [System Overview](#system-overview)
2. [Core Architecture](#core-architecture)
3. [Event Pipeline](#event-pipeline)
4. [Data-Driven Effects](#data-driven-effects)
5. [Advanced Patterns](#advanced-patterns)
6. [Implementation Strategy](#implementation-strategy)
7. [Common Challenges](#common-challenges)

---

## System Overview

### Design Goals

The system should support:
- **Dynamic turn order** where character speeds can be modified during combat, including stuns, slows, and variable cooldowns
- **Complex triggered effects** that can react to game events and spawn new events in response
- **Effect interactions** where passive effects can modify, augment, or react to other passive effects
- **Clean, maintainable code** despite the inherent complexity of cascading effects
- **Procedural generation** of effects from data files, allowing for randomized item properties and abilities

### Core Principle

**Separate modification from reaction.** This is the fundamental insight that prevents the system from becoming tangled. Effects that modify events (changing damage values, converting damage types) are conceptually and mechanically distinct from effects that react to events (counter-attacks, healing triggers). This separation maintains clear causality and prevents infinite loops.

---

## Core Architecture

### Turn Order System

#### Priority Queue Approach (Recommended)

Each character has a "next action time" value. When a character acts, they're removed from the queue, perform their action, and then reinserted with their next action time calculated based on their current speed.

**Key advantages:**
- Speed modifications automatically affect when characters act next
- Stunned characters simply aren't reinserted into the queue
- Abilities with different speeds naturally work (fast attack vs slow powerful spell)
- The upcoming turn order is always visible by looking at the queue

**How it handles modifications:**
- Speed buff: Recalculate action time when reinserted (acts sooner)
- Speed debuff: Recalculate action time when reinserted (acts later)
- Stun: Don't reinsert into queue for stun duration
- Instant turn: Give character immediate action time (top of queue)

#### Alternative: Timeline/Tick System

Time advances in small increments (ticks). Each character has a "next action tick" value. When the current tick matches their next action tick, they act and their next action tick is recalculated.

**Characteristics:**
- More granular control over exact timing
- Easier to implement "timed" effects (damage after 3 seconds)
- Slightly more complex to visualize upcoming turns
- Works well if you want sub-turn timing precision

### Event Structure

Events are the fundamental unit of action in the system. Every meaningful thing that happens is represented as an event.

**Core event properties:**
- **Type**: What kind of event (damage, heal, buff application, death, etc.)
- **Source**: The character or effect that caused this event
- **Target**: The character or entity receiving the event
- **Base values**: Original unmodified values (baseDamage, baseHeal, etc.)
- **Current values**: Modified values after effects apply (currentDamage, currentHeal, etc.)
- **Metadata**: Type-specific data (damage type, heal type, buff duration, etc.)
- **Flags**: A set of markers that provide context about the event's origin or nature
- **Depth**: How many levels deep in the event chain this event is
- **Parent reference**: Which event spawned this one (for tracking causality)

**Why base vs current values matter:**
Tracking both base and current values lets you see how much modification occurred without needing separate notification objects. For example:
- Event created with baseDamage: 50, currentDamage: 50
- After modifications: baseDamage: 50, currentDamage: 65
- Reactions can see the 15-point increase if needed

**Why flags matter:**
Flags prevent infinite loops and provide context. For example:
- An effect triggers when "you take damage"
- That effect deals damage, which could trigger the same effect again
- By marking the retaliatory damage with an "isRetaliation" flag, the effect can check for this flag and not trigger on its own damage

**Why depth matters:**
Depth tracking provides a hard safety limit. If an event chain reaches depth 10 (or some configured maximum), the system stops processing new events from that chain. This is the ultimate safeguard against infinite loops that might slip through flag checks.

---

## Event Pipeline

### The Four Phases

Events flow through a pipeline with four distinct phases. Each phase serves a specific purpose and runs in a specific order.

#### Phase 1: Meta-Modification (Modify Modifications)

**Purpose:** Modify how other modifications will work

**When effects run here:**
- Amplification effects ("Increase allies' damage bonuses by 50%")
- Modification converters ("Convert all flat damage bonuses to percentages")
- Conditional modification adjustments ("Double all bonuses against bosses")

**Key characteristic:** These effects don't directly modify the event. Instead, they modify how subsequent modification effects will behave. They run first with highest priority.

**How it works:**
Meta-modifications can either:
1. **Intercept modifications**: When another effect tries to modify, meta-mod adjusts the modification value
2. **Transform modifications**: Change the type or nature of modifications
3. **Conditionally enable/disable modifications**: Allow or prevent certain modifications based on context

**Example:**
- Effect A will add +10 damage (but hasn't run yet)
- Meta-mod B: "Amplify allies' damage bonuses by 50%"
- When effect A runs, B intercepts: 10 × 1.5 = 15
- Event is modified by +15 instead of +10

#### Phase 2: Modification (Direct Changes)

**Purpose:** Directly modify the event before it takes effect

**When effects run here:**
- Damage multipliers ("deal 50% more fire damage")
- Damage type conversions ("50% of physical damage is converted to fire")
- Conditional modifications ("deal double damage to enemies below 50% HP")
- Damage additions ("add 10 fire damage to attacks")
- Healing increases ("receive 30% more healing")

**Key characteristic:** Effects in this phase directly modify the event object. They change the damage amount, alter the damage type, add flags, or otherwise transform what's about to happen.

**Execution order within modification phase:**
Effects run in priority order (highest first). This is critical for mathematical correctness:
- Multipliers should run before flat additions
- Type conversions should run before type-specific bonuses

Example sequence:
1. "Multiply fire damage by 1.5" (priority 100, multiplier)
2. "Add 10 damage" (priority 50, flat addition)

Result: (50 base × 1.5 fire) + 10 = 85 damage

**Tracking modifications:**
The event maintains both base and current values, so you can see what changed:
- baseDamage: 50
- currentDamage: 85
- damageIncrease: 35

This tracking allows reactions to see what modifications occurred without needing separate notification objects.

#### Phase 3: Validation (Cancellation)

**Purpose:** Decide if the event should proceed at all

**When effects run here:**
- Block/dodge mechanics ("30% chance to block incoming damage")
- Immunity effects ("immune to fire damage")
- Threshold effects ("ignore damage below 5")
- Conditional negations ("can't be healed above 50% HP")

**Key characteristic:** Effects in this phase return true/false. If any effect returns false, the event is cancelled entirely and phase 4 doesn't run.

**Use case example:**
A shield that blocks the first 3 hits. On the third hit, the validation effect returns false, cancelling the damage entirely. The shield then removes itself.

**Important note:** Validation happens after all modifications. So if damage was increased from 50 to 80, the validation sees 80 damage, not 50.

#### Phase 4: Reaction (Spawn New Events)

**Purpose:** React to the event that just occurred

**When effects run here:**
- Counter-attacks ("when damaged, deal damage to attacker")
- On-kill effects ("when you kill an enemy, heal for 20 HP")
- Triggered abilities ("when you heal, gain a damage buff")
- Chain reactions ("attacks jump to nearby enemies")
- Modification-based triggers ("when damage dealt exceeds base damage by 20+, gain energy")

**Key characteristic:** Effects in this phase spawn new events rather than modifying the current event. These new events are added to the event queue and processed through the full pipeline, starting at phase 1.

**Critical detail:** New events inherit depth from their parent (parent.depth + 1) and reference their parent. This maintains the causality chain.

**Accessing modification information:**
Reactions can examine the difference between base and current values:
- If event.currentDamage > event.baseDamage + 20, spawn energy gain event
- Heal for (event.currentDamage - event.baseDamage) × 0.3

### Pipeline Processing Flow

The pipeline maintains an event queue. Processing continues until the queue is empty.

**For each event:**
1. Check depth—if over limit, skip this event and log warning
2. Run meta-modification phase—meta-effects set up modification interceptors
3. Run modification phase—all relevant effects modify the event (meta-effects may intercept)
4. Run validation phase—any effect can cancel the event
5. If cancelled, skip to next event in queue
6. Run resolution (built-in game logic)—apply the event to game state
7. Run reaction phase—collect all spawned events
8. Add spawned events to queue (with incremented depth, parent reference)
9. Continue to next event in queue

### Example: Complete Event Flow

**Setup:**
- Character A has: "Deal +20% damage"
- Character B (ally) has: "Amplify allies' damage bonuses by 50%"
- Character A has: "When you deal 15+ more damage than base, gain 1 energy"

**Initial event:** Character A attacks for 100 damage

**Processing:**

```
EVENT CREATED: {type: damage, source: A, target: Enemy, 
                baseDamage: 100, currentDamage: 100}

PHASE 1: META-MODIFICATION
  Effect: "Amplify allies' damage bonuses by 50%" (on B)
    - Registers interceptor for A's modifications
    - Waits for modification phase

PHASE 2: MODIFICATION
  Effect: "Deal +20% damage" (on A)
    - Wants to add: 100 × 0.2 = 20 damage
    - Meta-mod intercepts: 20 × 1.5 = 30 damage
    - Final modification: 100 → 130
  
  Event state: {baseDamage: 100, currentDamage: 130}

PHASE 3: VALIDATION
  No blocking effects
  Event continues

PHASE 4: RESOLUTION (built-in)
  Enemy loses 130 HP

PHASE 5: REACTION
  Effect: "When you deal 15+ more damage than base, gain energy" (on A)
    - Check: currentDamage - baseDamage = 30
    - 30 > 15, so trigger
    - Spawn: {type: gainResource, target: A, resource: energy, amount: 1}
  
  Add to queue: [gainResource event]

RESULT: Enemy took 130 damage, A gained 1 energy
```

---

## Data-Driven Effects

### The Registry Pattern

The core idea: Code defines atomic behaviors, data defines combinations and parameters.

**What lives in code:**
- Effect factories: Functions that create effects given parameters
- Trigger conditions: Reusable condition checks
- Action implementations: What actually happens when an effect activates
- Event type definitions: The structure of different event types

**What lives in data (JSON/CSV):**
- Effect templates: "This is what a 'thornmail' effect looks like"
- Parameter ranges: "Damage can be between 5 and 15"
- Weighted pools: "70% chance for common effects, 30% for rare effects"
- Conditional combinations: "If condition X, then action Y"

**The connection:**
Each effect in your data file has an "effectType" field that maps to a factory function in code. The factory function receives the parameters from the data and returns a configured effect object.

### Effect Composition

Rather than having one massive effect type for every possible combination, build effects from reusable pieces.

**Compositional structure:**
- **Trigger**: When does this effect activate? (on damage, on heal, on turn start)
- **Condition**: Should it activate right now? (is target below 50% HP? is damage fire?)
- **Action**: What happens? (deal damage, apply buff, heal)
- **Probability**: Does it always happen? (100% trigger vs 30% chance)

**Example in data format:**
```
Effect: "Chance to burn on fire attacks"
  Trigger: "self_attacks"
  Condition: "damage_is_fire"
  Action: "apply_burn_status"
  Probability: 0.4
```

This describes an effect that, when you attack with fire damage, has a 40% chance to apply a burn status to the target.

**Benefits:**
- Reusable pieces: "apply_burn_status" action can be used in many effects
- Easy to balance: Change burn damage in one place, affects all effects that use it
- Discoverable: You can list all possible triggers, conditions, and actions
- Procedurally generate: Pick random trigger + condition + action combinations

### Procedural Generation

For randomized loot, build generation pools.

**Pool structure:**
- List of possible effects with weights
- Parameter ranges for each effect type
- Constraints (maximum number of effects, tier restrictions)

**Generation process:**
1. Determine how many effects this item should have (based on rarity)
2. For each effect slot:
   - Roll which effect type based on weights
   - Roll parameters within ranges for that effect type
   - Create the effect with those parameters
3. Register all effects with the character when item is equipped

**Example generation:**

Item pool: "Weapon effects"
- 40% chance: Flat damage bonus (5-20 damage range)
- 30% chance: Life steal (5-15% range)
- 20% chance: Critical hit bonus (10-30% crit chance, 1.5-2.5x multiplier)
- 10% chance: Chain lightning (2-4 chains, 50-80% damage per chain)

Generate rare weapon (2 effect slots):
- Roll 1: Gets life steal, rolls 12%
- Roll 2: Gets critical hit, rolls 25% chance and 2.2x multiplier

Result: Weapon with 12% life steal and 25% chance for 2.2x damage crits

---

## Advanced Patterns

### Pattern 1: Meta-Modifications (Amplifying Bonuses)

**The concept:**
One effect modifies how another effect's modifications work. The classic example is "amplify allies' damage bonuses."

**How it works with the four-phase system:**

**Option A: Interception Pattern**
Meta-modifications register as interceptors. When a modification effect runs, it checks for active interceptors and adjusts its modification accordingly.

**Example flow:**
- Meta-effect B registers: "When ally A modifies damage, multiply the modification by 1.5"
- Effect A runs: "Add 10 damage"
- A checks for interceptors, finds B's 1.5x multiplier
- A applies: 10 × 1.5 = 15 damage instead of 10

**Option B: Two-Pass Collection**
Collect all pending modifications first, then let meta-modifications adjust them before applying.

**Example flow:**
1. Collect phase: Effect A wants to add +10, Effect C wants to multiply by 1.2
   - Collected: [{type: add, amount: 10}, {type: multiply, factor: 1.2}]
2. Meta-modification phase: Effect B amplifies ally modifications by 50%
   - Modified: [{type: add, amount: 15}, {type: multiply, factor: 1.2}]
3. Application phase: Apply all modifications to event
   - Result: (base × 1.2) + 15

**Tracking for reactions:**
The event maintains modification history if needed:
- event.baseDamage = 50
- event.currentDamage = 75
- event.modificationLog = [{source: effectA, amount: 15, amplifiedBy: effectB}]

### Pattern 2: Conditional Multi-Part Effects

**The problem:**
Some effects have multiple interconnected behaviors. "Deal more damage to low-HP enemies. When you kill an enemy this way, gain a buff." How do you track that a kill was specifically from the low-HP damage bonus?

**The solution: Event Tagging**

Effects can add custom flags to events they modify. Later effects can check for these flags.

**Example implementation:**

Component 1 (modification phase): "Deal 30% more damage to enemies below 50% HP"
- Checks target HP percentage
- If below threshold, multiply damage by 1.3
- Add flag: "executeDamage"
- Track in event: event.modifiedBy.add('executeEffect')

Component 2 (reaction phase): "When you kill an enemy, if they were executed, gain buff"
- Activates on death events
- Checks if death.causeEvent has flag "executeDamage"
- If yes, applies buff to character

**Alternative approach: Check modification magnitude**

Instead of flags, check if damage significantly exceeded base:

Reaction: "When you deal 30%+ more damage than base, on kill gain buff"
- Checks: event.currentDamage / event.baseDamage >= 1.3
- Only triggers on kills where damage was significantly modified
- Works for any large damage increase, not just execute

**Why this works:**
- Components are independent—can be mixed with other effects
- Flag/magnitude system prevents false triggers
- Composable—could have multiple effects checking for "executeDamage"

### Pattern 3: Stacking Effects with State

**The problem:**
"Each attack grants +5% damage (stacks up to 10 times). When damaged, consume all stacks to heal 3 HP per stack." The effect needs to track how many stacks it has.

**The solution: Effect Internal State**

Effects can have internal state variables that persist across triggers. This state is part of the effect object.

**Behavior description:**

Effect Part 1: Stack accumulation
- Triggers on dealing damage
- Increments internal stack counter (max 10)
- On first stack: Creates and registers a passive damage buff effect
- On additional stacks: Updates the passive buff's multiplier
- The buff multiplier is calculated as: 1.05^stackCount

Effect Part 2: Stack consumption
- Triggers on taking damage
- Finds the stacking effect (by searching for matching identifier)
- Reads current stack count
- Spawns heal event: 3 HP × stack count
- Resets stack count to 0
- Removes the damage buff effect

**Design considerations:**
- Link related effects together (stack tracker and damage buff)
- When removing parent effect, clean up child effects
- State should be simple values (numbers, booleans, strings)
- Avoid complex nested state structures

### Pattern 4: Chain Reactions with Diminishing Returns

**The problem:**
"Damage jumps to nearby enemies" could create exponential damage if enemies are clustered. Three enemies near each other would create infinite bouncing.

**The solution: Depth-Based Diminishing**

Chain effects track their chain depth and apply diminishing returns.

**Behavior description:**

Effect: "Attacks chain to nearby enemies for 70% damage, up to 3 chains"
- Activates on dealing damage
- Checks event's chainDepth property (0 if not set)
- If chainDepth >= 3, don't chain
- Calculate damage: baseDamage × (0.7 ^ chainDepth)
- Find nearby enemies (excluding the one just hit)
- For each nearby enemy, spawn new damage event:
  - Amount: calculated diminished damage
  - chainDepth: parent's chainDepth + 1
  - chainOrigin: parent's chainOrigin (or current target if parent wasn't a chain)
  - Flag: "isChain"

**Example with 3 enemies:**
- Initial attack: 100 damage to Enemy A (chainDepth 0)
- Chains to Enemy B: 70 damage (100 × 0.7, chainDepth 1)
- Chains to Enemy C: 49 damage (70 × 0.7, chainDepth 2)
- Would chain back to A: 34 damage (49 × 0.7, chainDepth 3), but chainDepth limit prevents it

**Additional safeguards:**
- Track chainOrigin to prevent immediate bounce-backs
- Can't chain to the same target twice in one sequence
- Can't chain to the original attacker
- Check "isChain" flag to prevent effects from triggering on chain damage

### Pattern 5: Duration-Based Effects

**The problem:**
Status effects like poison or buffs need to last for a certain number of turns and then expire.

**The solution: Effect Lifecycle Management**

Effects can have duration properties and respond to turn events.

**Behavior description:**

Effect structure:
- Duration: Number of turns remaining (or "permanent" for non-expiring)
- Temporary flag: Marks effects that should be cleaned up
- Turn event subscription: Activates on turn start/end

**Management process:**
1. When effect is added, set duration
2. At start/end of each turn (configurable), decrement duration for all temporary effects
3. When duration reaches 0, remove effect and unregister from pipeline
4. Some effects trigger on removal (cleanse effects, expiration damage, etc.)

**Special cases:**
- "Until end of combat" effects: Duration = infinity, but cleared on combat end
- "For 2 of your turns" vs "for 2 turns total": Track whose turn decrements the duration
- Stackable duration: New applications extend or replace existing duration
- Refresh mechanics: Some effects reset to max duration on re-application

### Pattern 6: Effect Upgrades and Transformations

**The problem:**
"After dealing fire damage 5 times, your fire effects evolve into inferno effects (50% stronger)." How do you track progress and upgrade existing effects?

**The solution: Effect Transformation System**

Effects can track progress toward upgrades and transform themselves or spawn upgraded versions.

**Behavior description:**

Tracking effect:
- Has state: fireCount = 0
- Triggers on dealing fire damage
- Increments fireCount
- When fireCount reaches 5:
  - Finds all fire-related effects on character
  - Replaces each with "inferno" version (either by modifying parameters or swapping effect types)
  - Optionally: Creates visual indicator, plays sound, spawns notification event

**Implementation approaches:**

Approach A: Modify parameters
- Keep same effect type
- Multiply damage parameters by 1.5
- Add "inferno" flag to differentiate behavior

Approach B: Effect replacement
- Remove fire effects
- Add new inferno effects with different effect types
- Allows completely different behavior, not just number changes

Approach C: Wrapper effect
- Add a new meta-effect that boosts fire damage
- Keep original effects unchanged
- Easier to track and remove upgrade state

---

## Implementation Strategy

### Phase 1: Core Infrastructure

**What to build first:**
1. Event type definitions (damage, heal, buff, death)
2. Event pipeline with four phases
3. Character class with effect management (add, remove)
4. Basic turn queue system
5. Simple combat loop that processes one turn

**Validation:**
- Manually create an effect object
- Add it to a character
- Trigger combat turn where effect should activate
- Verify effect runs in correct phase

### Phase 2: Effect Registry

**What to build next:**
1. Registry object/map to hold effect factories
2. 3-5 basic effect types (flat damage, damage multiplier, life steal, thorns, damage reduction)
3. Factory functions that create configured effects
4. Test creating effects from registry

**Validation:**
- Create effects using registry
- Add to characters
- Run combat scenario where effects should interact
- Verify correct execution order (multipliers before additions)

### Phase 3: Data Loading

**What to build next:**
1. JSON schema for effect definitions
2. Data loader that reads JSON and creates effects via registry
3. Parameter range rolling (min/max values)
4. A few example effect definitions in JSON

**Validation:**
- Load effect definitions from JSON
- Create effects for characters
- Run same combat scenarios, verify identical behavior to hardcoded effects

### Phase 4: Loop Prevention

**What to build next:**
1. Depth tracking in events
2. Flag system for event marking
3. Safety checks in pipeline (depth limit)
4. Flag checks in effect conditions ("don't trigger on retaliation")

**Validation:**
- Create scenario with potential infinite loop (counter-attack that triggers counter-attack)
- Verify depth limit or flags prevent infinite processing
- Check that intentional chains still work (attack → counter → triggered heal)

### Phase 5: Advanced Features

**What to build next (in any order):**
1. Meta-modification interceptors (effects that modify other modifications)
2. Conditional effects (condition registry)
3. Effect state management (stacking, cooldowns, duration)
4. Composition system (trigger + condition + action)
5. Procedural generation pools

**Validation:**
- Create complex scenarios using each feature
- Test edge cases (what if stack effect is removed mid-combat?)
- Verify interactions (meta-modification amplifying multiple bonuses)

### Phase 6: Polish and Tools

**What to build last:**
1. Debugging tools (event logger, effect inspector)
2. Visualization (event tree, effect listing)
3. Validation layer (schema checking for JSON)
4. Performance optimization (effect indexing, object pooling)
5. Effect preview system (show what effect would do without applying it)

### Testing Strategy

**Unit testing approach:**
- Test each effect type in isolation
- Verify effect activates on correct event type
- Verify effect doesn't activate on wrong event type
- Verify parameters affect behavior correctly
- Test edge cases (0 damage, negative values, null targets)

**Integration testing approach:**
- Test effect combinations (two effects modifying same event)
- Test execution order (priority system)
- Test event chains (effect spawning multiple events)
- Test state persistence (stacking effects across turns)
- Test cleanup (effect removal, duration expiration)

**Scenario testing approach:**
- Create realistic combat scenarios
- Define expected outcome
- Run combat, verify actual outcome matches expected
- Examples: "Poison damage over 3 turns", "Life steal keeping character alive", "Chain lightning spreading to all enemies"

---

## Common Challenges

### Challenge 1: Infinite Loops

**Symptoms:**
- Game hangs/freezes during combat
- Stack overflow errors
- Event processing never completes

**Root causes:**
- Effect A triggers Effect B which triggers Effect A
- Chain reaction with no end condition
- Modification triggering its own modifier repeatedly

**Prevention strategies:**
1. **Depth limits**: Hard cap at 10 levels deep
2. **Flag checking**: Mark event origins, check before triggering
3. **Cooldowns**: Internal effect cooldown before triggering again
4. **Explicit exclusions**: "Don't trigger on events with flag X"
5. **Careful design**: Review all effect combinations during design

**Detection and debugging:**
- Log event depth when processing
- Log effect activation with source
- Add warning when approaching depth limit
- Visualize event chain to see loop pattern

### Challenge 2: Unclear Execution Order

**Symptoms:**
- Effects sometimes work, sometimes don't
- Inconsistent damage calculations
- Unexpected behavior when multiple effects present

**Root causes:**
- No priority system (effects run in arbitrary order)
- Priority values inconsistent (additions running before multiplies)
- Phase confusion (modification effect in reaction phase)

**Solutions:**
1. **Explicit priorities**: Every effect has a priority value
2. **Priority conventions**: Document standard ranges (150+ meta-mods, 100 multipliers, 50 additions)
3. **Phase discipline**: Meta-mods in phase 1, modifications in phase 2, reactions in phase 5
4. **Sort before processing**: Always sort by priority before running effects
5. **Testing**: Create scenarios where order matters, verify consistent results

### Challenge 3: Lost Context

**Symptoms:**
- Can't determine why damage was dealt
- Difficulty debugging event chains
- Unclear what triggered an effect

**Root causes:**
- No causality tracking between events
- Missing metadata on events
- Inadequate logging

**Solutions:**
1. **Parent references**: Every spawned event references its parent
2. **Origin tracking**: Maintain chain origin through multiple jumps
3. **Descriptive flags**: Use meaningful flag names that explain event purpose
4. **Event IDs**: Assign unique ID to each event for tracking
5. **Comprehensive logging**: Log event creation, modification, and resolution

### Challenge 4: Performance Degradation

**Symptoms:**
- Combat becomes slow with many effects
- Lag spikes during effect processing
- Longer turns as combat progresses

**Root causes:**
- Checking every effect for every event
- Creating too many temporary objects
- Inefficient data structures
- Memory leaks from not cleaning up effects

**Solutions:**
1. **Effect indexing**: Group effects by event type they care about
2. **Early returns**: Exit effect handlers as soon as possible
3. **Object pooling**: Reuse event objects instead of creating new ones
4. **Batch operations**: Process multiple similar effects together
5. **Profiling**: Measure where time is spent, optimize hot paths

### Challenge 5: Data Definition Errors

**Symptoms:**
- Effects don't appear on items
- Silent failures during effect creation
- Effects with incorrect behavior

**Root causes:**
- Typos in effect type names
- Missing required parameters
- Invalid parameter values
- Effect type not registered

**Solutions:**
1. **Schema validation**: Check data files against schema on load
2. **Registry validation**: Verify effect type exists before using
3. **Parameter validation**: Check required parameters present and valid
4. **Error messages**: Provide helpful errors (list available effect types)
5. **Development mode**: Extra validation during development, minimal in production

### Challenge 6: State Synchronization

**Symptoms:**
- Stacks not updating correctly
- Duration counts incorrect
- Effect state gets out of sync with game state

**Root causes:**
- State modified in multiple places
- Forgetting to update state after event
- State not persisted correctly
- Race conditions (if multithreaded)

**Solutions:**
1. **Single source of truth**: One place owns each piece of state
2. **State encapsulation**: Only owner can modify state
3. **Event-driven updates**: State changes trigger events, not direct modification
4. **Consistency checks**: Validate state at turn boundaries
5. **State snapshots**: Save state history for debugging

### Challenge 7: Complex Effect Composition

**Symptoms:**
- Need many special-case effects
- Hard to express desired behavior in data
- Effects becoming bloated with conditional logic

**Root causes:**
- Trying to express too much in single effect
- Missing primitives in composition system
- No way to combine simpler effects

**Solutions:**
1. **Smaller primitives**: Break effects into smallest reusable pieces
2. **Composition support**: Allow effects to contain sub-effects
3. **Condition chaining**: Multiple conditions with AND/OR logic
4. **Action sequences**: Series of actions from one trigger
5. **Accept complexity**: Some effects need custom code, that's okay

---

## Design Principles Summary

### Separation of Concerns
- Modifications (preprocessing) separate from reactions (postprocessing)
- Data defines what, code defines how
- Event creation separate from event processing

### Safety First
- Depth limits prevent infinite loops
- Flags prevent unintended triggers
- Validation phase can cancel dangerous events

### Clarity Over Cleverness
- Explicit phases with clear purposes
- Descriptive naming for effects and flags
- Comprehensive logging and debugging tools

### Composability
- Small, reusable effect pieces
- Mix and match triggers, conditions, actions
- Effects that build on other effects

### Data-Driven Flexibility
- Balance changes don't require code changes
- Procedural generation from data pools
- Easy to add new effects via data

### Performance Awareness
- Early returns to avoid unnecessary work
- Indexing to reduce search space
- Pooling for frequently created objects

---

## Quick Reference

### Event Pipeline Phases
1. **Meta-Modification** - Modify how modifications work (amplify bonuses, transform modifications)
2. **Modification** - Modify event values and properties (multiply damage, add bonuses, convert types)
3. **Validation** - Decide if event should proceed (can cancel)
4. **Resolution** - Apply event to game state (built-in game logic)
5. **Reaction** - React to event, spawn new events (counter-attacks, triggers)

### Priority Guidelines
- **150+**: Meta-modifications (amplify allies' bonuses, global modification adjustments)
- **100**: Multiplicative modifiers (×1.5 damage, ×2 healing)
- **50**: Additive modifiers (+10 damage, +5 healing)
- **0**: Reactive effects (counter-attacks, on-damage triggers)

### Loop Prevention Checklist
- [ ] Depth counter on all events
- [ ] Depth limit check in pipeline (typically 10)
- [ ] Flags for event origins (isRetaliation, isChain, etc.)
- [ ] Flag checks in effect conditions
- [ ] Parent event references for debugging

### Effect Design Checklist
- [ ] Clear trigger condition (when does it activate?)
- [ ] Appropriate phase (meta-mod, modify, validate, or react?)
- [ ] Correct priority (relative to similar effects)
- [ ] Loop prevention (won't trigger on own events?)
- [ ] Parameter validation (sensible ranges?)
- [ ] Edge case handling (what if target is dead?)

### Tracking Modifications

Events maintain base and current values to track modifications:
- `baseDamage`: Original unmodified amount
- `currentDamage`: After all modifications
- `damageIncrease`: currentDamage - baseDamage

This allows reactions to detect and respond to modifications:
- "If damage increased by 20+, spawn X"
- "Heal for 30% of damage increase"
- "When damage exceeds base by 50%, add critical flag"

### Data Format Essentials
- **Effect Type**: Maps to registry entry
- **Parameters**: Configurable values (damage, duration, chance)
- **Ranges**: Min/max for procedural generation
- **Weights**: Relative probability in generation pools
- **Conditions**: Optional requirements for activation

### Common Event Flags
- `isRetaliation` - Damage from counter-attack
- `isChain` - Damage from chain/bounce effect
- `isSecondary` - Spawned from another effect
- `isCritical` - Critical hit
- `executeDamage` - Low-HP execution bonus
- `isPoisonDamage` - Damage from poison DoT
- `fromModification` - Event spawned by modification

### Debugging Approaches
1. **Event logging** - Print every event with depth and flags
2. **Effect tracing** - Log when each effect activates
3. **Event tree visualization** - Display parent-child relationships
4. **State inspection** - View all effects and their state
5. **Breakpoint debugging** - Pause at specific event types
6. **Replay system** - Save and replay combat sequences

---

## Closing Thoughts

This system's power comes from its simplicity at the core (events flowing through phases) combined with flexibility at the edges (composable effects, data-driven configuration). The key to successful implementation is:

1. **Start small** - Get basic pipeline working with simple effects
2. **Test continuously** - Verify each addition works before moving on
3. **Document as you go** - Note design decisions and trade-offs
4. **Embrace iteration** - First version won't be perfect, refine based on use
5. **Plan for debugging** - Build tools early, you'll need them

The most common pitfall is trying to build everything at once. Focus on getting a minimal version working (damage events, one modify effect, one reaction effect) and expand from there. Each new feature should be validated in isolation before combining with others.

Remember that perfect balance is impossible—you're building a system that allows for nearly infinite combinations. Some combinations will be overpowered, some will be useless. The goal is to make the system flexible enough that you can easily adjust numbers and add counters when you discover problematic combinations.

Good luck with your implementation!
