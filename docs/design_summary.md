# Turn-Based RPG Effect System - Design Summary

## Document Overview

This document summarizes all the design decisions made for a turn-based RPG effect system. It serves as a reference for the chosen architecture, terminology, and implementation approach.

---

## Core Philosophy

**Priority: Keep the mental model clean and fun to work with.**

The system prioritizes:
1. **Clarity** - Easy to understand what's happening and why
2. **Simplicity** - Avoid unnecessary complexity
3. **Maintainability** - Easy to add new effects and debug issues
4. **Flexibility** - Support complex interactions without special cases

---

## System Architecture

### The Event Pipeline

Events flow through a **four-phase pipeline**:

1. **Meta-Modification Phase**
   - Purpose: Modify how other modifications will work
   - Example: "Amplify allies' damage bonuses by 50%"
   - Priority: 150+
   - Runs first

2. **Modification Phase**
   - Purpose: Directly modify event values
   - Example: "Add 10 damage", "Multiply damage by 1.5"
   - Priority: 100 (multiply), 50 (add)
   - Runs second

3. **Validation Phase**
   - Purpose: Decide if event should proceed (can cancel)
   - Example: "30% chance to block", "Immune to fire"
   - Priority: 0
   - Runs third

4. **Resolution Phase**
   - Purpose: Apply the event to game state
   - Built-in game logic (HP changes, buff application, etc.)
   - Not extensible by effects

5. **Reaction Phase**
   - Purpose: React to events, spawn new events
   - Example: "When damaged, counter-attack", "Life steal"
   - Priority: 0
   - Runs last

**Key Insight:** Separating modification (change what's about to happen) from reaction (respond to what happened) keeps causality clear and prevents confusion.

---

## Core Terminology

### Established Terms

**Action**
- A direct combat turn choice taken by a character
- Examples: Attack, use ability, defend, use item
- Has properties: damage, targets, speed modifier

**Effect**
- Something that causes or modifies events
- Lives on characters, items, stage/map, or any other entity
- Triggered by events flowing through the pipeline
- Has properties: phase, priority, event types to listen for

**Event**
- A pending game state change that flows through the pipeline
- Examples: Damage, heal, buff application, death
- Has properties: type, source, target, values, flags, depth

**Modification**
- A change to an event (the action of modifying)
- Can be conditional or limited in some way
- Happens in the modification phase

**Actor**
- Any entity that can participate in combat or have effects
- Includes: Characters, environmental hazards, map conditions, global effects
- Has properties: stats, effects, turn scheduling

**Character**
- An Actor with player/NPC concerns
- Has additional properties: inventory, equipment, class, experience

**PropertyGrant**
- What an item/buff/class provides to a character
- Contains: stat bonuses, actions, effects
- Declarative structure

---

## Meta-Modifications: The Simplified Approach

### What Was Rejected

**Complex modification notification system:**
- Modification events as separate event type
- Nested sub-pipeline for processing modifications
- Modifications spawning their own events
- Three-layer system: modifications → modification events → reactions to modifications

**Why rejected:** Added significant complexity with minimal benefit. Most use cases could be handled more simply.

### What Was Chosen

**Two-pass modification system:**

1. **Meta-modifications run first** (priority 150+)
   - Can see what modifications are about to happen
   - Can adjust those modifications
   - Example: "Amplify damage increases" sees a +10 and changes it to +15

2. **Regular modifications run second** (priority 100, 50)
   - Apply their changes to the event
   - Already adjusted by meta-modifications if applicable

**How it works:**
- Meta-modifications can intercept or transform other modifications
- Track base vs current values on events (baseDamage vs currentDamage)
- Reactions can check the difference to detect modifications

**Example:**
```
Event: Attack for 50 damage
  Meta-mod phase: "Amplify bonuses by 50%" registers interceptor
  Modification phase: "Add 10 damage" effect wants to add 10
    → Interceptor catches it: 10 × 1.5 = 15
    → Event becomes 65 damage (50 base + 15)
  Reaction phase: "Heal for % of damage increase" sees 65 - 50 = 15 increase
```

**Benefits:**
- Simple mental model
- No nested pipelines
- No modification notification objects
- Reactions can still detect modifications by comparing base vs current

---

## Turn Order System

### Tick-Based Scheduling (Chosen Approach)

**Core concept:** Time advances in discrete ticks. Each actor has "ticks until next action."

**Structure:**
```
Combat {
  currentTick: number
  actorSchedule: Map<Actor, ticksUntilAction>
}
```

**How turns work:**
1. Find actor(s) with lowest tick count
2. Advance time to that tick value
3. Execute all actors with 0 ticks
4. Reschedule actors based on speed

**Speed calculation:**
```
delay = 10000 / effectiveSpeed
```

Examples:
- Speed 100 → 100 ticks between actions
- Speed 200 → 50 ticks between actions
- Speed 50 → 200 ticks between actions

**Variable action speeds:**
Actions can have speed multipliers:
- Fast attack: speed 0.5 → half the delay
- Slow powerful attack: speed 2.0 → double the delay

**Benefits:**
- Precise timing control
- Natural support for speed buffs/debuffs
- Easy to grant immediate actions (set ticks to 0)
- Easy to implement stuns (add ticks)
- Can preview upcoming turn order

**Why not alternatives:**
- Simple turn counter: Less precise, harder to do variable speeds
- Real-time with pausing: Overcomplication for turn-based game

---

## Property Aggregation

### The Decision: Collection on Access

**Items, buffs, and class own their properties. Character collects them when needed.**

**Structure:**
```typescript
Item/Buff/Class {
  grants: {
    stats?: {flat?: StatBlock, percent?: StatBlock}
    actions?: Action[]
    effects?: EffectDefinition[]
  }
}

Character {
  equipment: Item[]
  class: Class
  buffs: Buff[]
  
  // Collect on access
  get effectiveAttack() {
    let attack = this.baseStats.attack
    attack += this.class.grants.stats?.flat?.attack || 0
    this.equipment.forEach(item => attack += item.grants.stats?.flat?.attack || 0)
    
    let percent = 1.0
    this.buffs.forEach(buff => percent *= buff.grants.stats?.percent?.attack || 1.0)
    
    return attack * percent
  }
}
```

**What happens on equip/unequip:**
```typescript
equipItem(item) {
  this.equipment.push(item)  // Just add to array
  // Stats automatically collected on next access
  
  // Effects need explicit registration
  if (item.grants.effects) {
    item.grants.effects.forEach(def => {
      const effect = createEffect(def, this)
      this.addEffect(effect, `item:${item.id}`)
    })
  }
}

unequipItem(item) {
  this.equipment = this.equipment.filter(i => i !== item)  // Remove from array
  this.removeEffectsFromSource(`item:${item.id}`)  // Cleanup effects
}
```

**Key insight: Only track sources for things that need explicit cleanup**

- **Stats/Actions:** Just collect on access (stateless, no cleanup needed)
- **Effects:** Track by source (stateful, need pipeline unregistration)

**Why this approach:**

**Mental model:**
- Simple: "What's my attack? Add up all the sources."
- Self-correcting: No cache to get out of sync
- Less state: No activeGrants map to maintain

**Performance:**
- Stats accessed ~10-100 times per turn
- Each access: ~15-20 operations (object access, addition)
- This is microseconds in JavaScript
- No meaningful difference from caching for turn-based games

**Rejected alternatives:**
- Cached grants with source tracking: More complexity, sync bugs, no real benefit
- Pure collection without any tracking: Can't clean up effects properly

---

## Actor System

### Unified Actor Model

**One base type for everything:**

```typescript
Actor {
  id: string
  name: string
  effects: Effect[]
  baseStats: StatBlock
  takesTourns: boolean
  effectsBySource: Map<string, Effect[]>  // For cleanup
}

Character extends Actor {
  equipment: Item[]
  class: Class
  buffs: Buff[]
  // Player-facing stuff
}
```

**Key decisions:**

1. **No separate Actor vs Character distinction at system level**
   - Character is just Actor with inventory/progression features
   - System treats them the same

2. **Environmental effects are Actors**
   - Volcano that erupts periodically: Actor with takesTourns=true
   - Beach that grants speed buff at start: Actor with effects, takesTourns=false
   - Map hazards: Actors that participate in event pipeline

3. **takesTourns flag determines scheduling**
   - `true`: Added to turn queue, takes actions
   - `false`: Only reacts to events, never acts

**Examples:**

```typescript
// Character
warrior = new Character({
  baseStats: {hp: 100, attack: 20, speed: 100},
  class: warriorClass,
  takesTourns: true
})

// Environmental actor with turns
volcano = new Actor({
  baseStats: {speed: 20},
  takesTourns: true
})
volcano.chooseAction = () => ({
  type: 'erupt',
  damage: 10,
  targets: 'all'
})

// Passive environmental effect
beachBuff = new Actor({
  takesTourns: false,
  effects: [onCombatStart_grantSpeedBuff]
})
```

**Benefits:**
- Unified system
- Flexible (anything can have effects)
- Simple (one concept, not two)

---

## Loop Prevention

### Three-Layer Safety

**1. Depth Limiting (Primary safety)**
```typescript
Event {
  depth: number  // How many levels deep in chain
}

// In pipeline
if (event.depth > 10) {
  console.warn("Chain too deep, stopping")
  return
}
```

**2. Event Flags (Semantic prevention)**
```typescript
Event {
  flags: Set<string>  // 'isRetaliation', 'isChain', 'isSecondary'
}

// In effect
if (event.flags.has('isRetaliation')) {
  return  // Don't trigger on retaliation
}
```

**3. Parent References (Debugging)**
```typescript
Event {
  parentEvent?: Event  // What spawned this
}

// For debugging chains
function traceEventChain(event) {
  let current = event
  while (current) {
    console.log(current.type)
    current = current.parentEvent
  }
}
```

**Common flags:**
- `isRetaliation` - Damage from counter-attack
- `isChain` - Damage from chain/bounce
- `isSecondary` - Spawned from another effect
- `isCritical` - Critical hit
- `isDoT` - Damage over time
- `fromLifeSteal` - Heal from life steal

---

## Effect Registration

### Source-Tracked for Cleanup

**The pattern:**
```typescript
Character {
  effectsBySource: Map<string, Effect[]>
  
  addEffect(effect: Effect, source: string) {
    this.effects.push(effect)
    
    const sourceEffects = this.effectsBySource.get(source) || []
    sourceEffects.push(effect)
    this.effectsBySource.set(source, sourceEffects)
    
    // Register with pipeline
    pipeline.registerEffect(effect, this)
  }
  
  removeEffectsFromSource(source: string) {
    const effects = this.effectsBySource.get(source) || []
    effects.forEach(effect => {
      this.effects = this.effects.filter(e => e !== effect)
      pipeline.unregisterEffect(effect, this)
    })
    this.effectsBySource.delete(source)
  }
}
```

**Source naming convention:**
- `item:${itemId}` - Effects from items
- `buff:${buffId}` - Effects from buffs
- `ability:${abilityId}` - Effects from abilities
- `innate` - Built-in effects

**Benefits:**
- Clean removal when items unequipped
- Clean removal when buffs expire
- Can inspect what each source provides
- Easy debugging ("where is this effect from?")

---

## Data-Driven Design

### Effect Definition Format

**In data files (JSON):**
```json
{
  "effectType": "onAttack_addDamage",
  "params": {
    "amount": 10,
    "damageType": "fire"
  }
}
```

**In code (Effect Registry):**
```typescript
EffectRegistry['onAttack_addDamage'] = (params) => ({
  id: `addDamage_${random()}`,
  name: `Add ${params.amount} damage`,
  phase: 'modification',
  priority: 50,
  eventTypes: ['damage'],
  
  handler: (event, owner) => {
    if (event.source === owner) {
      event.currentDamage += params.amount
    }
  }
})
```

**Item Definition:**
```json
{
  "id": "flamesword",
  "name": "Flame Sword",
  "grants": {
    "stats": {
      "flat": {"attack": 10}
    },
    "effects": [
      {
        "effectType": "onAttack_addDamage",
        "params": {"amount": 5, "damageType": "fire"}
      }
    ]
  }
}
```

**The pattern:**
- **Code defines behaviors** - Small, atomic, reusable effect types
- **Data defines combinations** - Which effects, with what parameters
- **Registry connects them** - Map effect type names to factory functions

**Benefits:**
- Add new items without code changes
- Balance changes in data files
- Procedural generation from data pools
- Easy to inspect/validate data

---

## Event Structure

### Base vs Current Values

**Track both original and modified values:**

```typescript
DamageEvent {
  baseDamage: number      // Original unmodified value
  currentDamage: number   // After all modifications
  // ... other properties
}
```

**Why this matters:**

1. **Reactions can detect modifications**
   ```typescript
   if (event.currentDamage - event.baseDamage >= 20) {
     // Trigger "bonus damage" effect
   }
   ```

2. **Meta-modifications can see base values**
   ```typescript
   const increase = event.currentDamage - event.baseDamage
   const amplified = increase * 1.5
   event.currentDamage = event.baseDamage + amplified
   ```

3. **Debugging and display**
   ```typescript
   console.log(`${baseDamage} → ${currentDamage} damage`)
   // "50 → 75 damage"
   ```

**Applied to other events:**
- HealEvent: `baseAmount` vs `currentAmount`
- Any event with modifiable values tracks both

---

## Priority System

### Standard Priority Ranges

**Meta-Modifications: 150+**
- Highest priority
- Modify how other modifications work
- Examples: "Amplify bonuses", "Transform damage type increases"

**Multiplicative Modifiers: 100**
- Run before additions
- Examples: "×1.5 damage", "×2 healing"

**Additive Modifiers: 50**
- Run after multiplications
- Examples: "+10 damage", "+5 healing"

**Reactions: 0**
- Default for effects that spawn new events
- Examples: "Life steal", "Counter-attack"

**Mathematical correctness:**
```
(base × multiplier) + flat
(50 × 1.5) + 10 = 85

Not:
(base + flat) × multiplier
(50 + 10) × 1.5 = 90
```

**Within the same priority:**
- Effects run in registration order
- Usually doesn't matter (commutative)
- If it matters, use sub-priorities (101, 102, etc.)

---

## Non-Character Actors

### Scheduling Approaches

**Passive Actors (Most Common)**
- Don't take turns
- Only react to events
- `takesTourns: false`

Example - Periodic hazard:
```typescript
volcano = new Actor({
  takesTourns: false,
  effects: [
    {
      trigger: 'onTurnEnd',
      condition: (event) => event.turnCount % 3 === 0,
      action: () => dealFireDamageToAll(5)
    }
  ]
})
```

**Active Actors (Special Cases)**
- Take turns in action order
- `takesTourns: true`
- Have a `chooseAction()` method

Example - Timed bomb:
```typescript
bomb = new Actor({
  takesTourns: true,
  speed: 100,  // Acts once at specific time
  
  chooseAction() {
    explode()
    combat.removeActor(this)
    return {type: 'explode'}
  }
})
```

**When to use which:**
- **Passive:** Environmental effects, auras, periodic hazards
- **Active:** Timed events, boss mechanics needing precise timing

---

## Implementation Language

### TypeScript (Chosen)

**Why TypeScript:**
- Rapid iteration
- JSON → Objects is trivial
- Registry pattern + closures = clean effect system
- Gradual typing (strict where needed, flexible elsewhere)
- Excellent tooling

**Where to add strictness:**
```typescript
// Strict for core event types
type DamageEvent = {
  type: 'damage'
  source: Actor
  // ...
}

// Flexible for effect params
type EffectParams = Record<string, unknown>

// Discriminated unions for type safety
type GameEvent = DamageEvent | HealEvent | BuffEvent
```

**Performance is not a concern:**
- Turn-based game
- ~10-100 stat accesses per turn
- Collection on access is microseconds
- Event processing is milliseconds
- More than adequate

---

## Design Patterns Used

### Registry Pattern
Map string keys to factory functions
```typescript
EffectRegistry['effectName'] = (params) => effect
```

### Factory Pattern
Functions that create configured objects
```typescript
const effect = createEffect(definition, owner)
```

### Observer Pattern
Effects subscribe to event types
```typescript
effect.eventTypes = ['damage', 'heal']
```

### Pipeline Pattern
Sequential phases of processing
```typescript
meta-mod → modification → validation → resolution → reaction
```

### Composition Pattern
Build complex behaviors from simple pieces
```typescript
PropertyGrant {
  stats + actions + effects
}
```

---

## Testing Strategy

### Unit Tests
- Each effect type in isolation
- Verify triggers on correct events
- Verify doesn't trigger on wrong events
- Test parameter variations

### Integration Tests
- Multiple effects on same event
- Priority ordering
- Event chains
- State management

### Scenario Tests
- Realistic combat scenarios
- Define expected outcomes
- Verify actual matches expected
- Examples: Life steal survival, poison damage over time

---

## Future Extensions

### Easy to Add

**New effect types:**
- Just add to EffectRegistry
- Update data files
- No changes to pipeline

**New event types:**
- Add to EventType union
- Implement resolution logic if needed
- Effects can subscribe to it

**New stat types:**
- Add to StatBlock type
- Collection automatically handles it

### Harder to Add (Requires Core Changes)

**New pipeline phases:**
- Would need to update EventPipeline
- Update all effect definitions
- Significant refactor

**Different scheduling system:**
- Would need to rewrite Combat
- Update Actor interface
- Major change

**Resource system (mana, energy):**
- Add ResourceType enum
- Add resource events
- Add resource tracking to Actor
- Moderate change

---

## Key Learnings

### What Worked Well

1. **Separating modification from reaction**
   - Clear causality
   - Easy to reason about
   - Prevents confusion

2. **Collection on access for stats**
   - Simple mental model
   - No sync bugs
   - Good enough performance

3. **Source tracking for effects only**
   - Minimal tracking
   - Clean cleanup
   - Pragmatic

4. **Tick-based scheduling**
   - Precise control
   - Natural speed modifiers
   - Easy to implement special cases

5. **Unified Actor model**
   - Flexible
   - Simple
   - Handles all use cases

### What Was Avoided

1. **Modification notification events**
   - Too complex
   - Minimal benefit
   - Base/current values solve the same problems

2. **Cached property aggregation**
   - Sync complexity
   - Cache invalidation
   - No performance benefit for turn-based

3. **Separate Actor/Character types at system level**
   - Unnecessary distinction
   - More complexity
   - Unified model cleaner

---

## Quick Reference

### When to use each phase

**Meta-Modification:**
- Amplify other effects
- Transform how modifications work
- "All allies' bonuses are 50% stronger"

**Modification:**
- Change event values
- Add damage, multiply healing
- "Deal 10 more damage"

**Validation:**
- Cancel events
- Block, dodge, immunity
- "30% chance to block"

**Reaction:**
- Respond to events
- Spawn new events
- "When damaged, counter-attack"

### Common pitfalls

❌ **Modifying in reaction phase** - Won't work, event already resolved  
✓ Modify in modification phase

❌ **Reacting in modification phase** - Creates new events during modifications  
✓ React in reaction phase

❌ **Forgetting to check flags** - Causes infinite loops  
✓ Always check isRetaliation, isChain, etc.

❌ **Not tracking effect sources** - Can't remove effects cleanly  
✓ Always provide source when adding effects

❌ **Caching stats** - Adds complexity for no benefit  
✓ Collect on access

---

## Conclusion

This design prioritizes **clarity and simplicity** while maintaining **flexibility and power**. The four-phase pipeline provides clear separation of concerns. The tick-based scheduling gives precise control. The property aggregation approach keeps the mental model clean. The unified Actor model handles all use cases elegantly.

The system is designed to be **fun to work with** - adding new effects is straightforward, debugging is clear with proper logging, and the architecture supports complex interactions without special-casing.

Most importantly: **the system works for turn-based games**, where clarity and maintainability matter more than micro-optimizations.
