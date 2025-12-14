import type { StatFlat, StatMult } from "./stats";

/** */
class Combat {
  actors: Actor[] = [];
  // TODO: Charater[]
  combatants: Actor[] = [];
}

/** Direct combat choice taken by a character or actor */
type Action = {};

/**
 * Anything that can take an {@link Action}. This may include characters or
 * combat participants, map or stage effects, global events, or other
 *
 */
class Actor {
  name: string = "nameme";
  uuid: string = "needsUuid";
  useTurnOrder?: boolean = false;
  effects?: Effect[]; // effects innate to this actor
  properties?: ActorProperty[]; //
  // need a way for actors to act outside of turn order because they don't have
  // initiative/speed
}

class Character extends Actor {
  name = "charNeedsName";
}

type ActorProperty = {
  stats?: {
    flat?: StatFlat[];
    mult?: StatMult[];
  };
};

/** Something that causes or modifies one or more {@link Event}s */
type Effect = {};

/**
 * A pending game state change, processed in pipeline before being applied.
 * Modified by {@link Modification}s
 * Causes {@link Reaction}s after resolution
 */
type Event = {};

/**
 * A change to an {@link Event} before it is applied.
 * During processing, Modifications pend so that they may be further modified by
 * {@link MetaModification}s.
 */
type Modification = {};

/**
 * A modifier to a {@link Modification}, for example a multiplier to an already
 * pending stat increase.
 */
type MetaModification = {};

/**
 * A mechanism for automatically triggering an {@link Event} in response to some
 * condition or other happening.
 */
type Reaction = {};
