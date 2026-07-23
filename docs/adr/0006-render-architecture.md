# 0006 — Render architecture for the hero visuals

## Context

§8 asks for hero visuals that carry real data — a flowing particle field
whose velocity and density are live throughput, a pipe that visibly clogs
when loaded latency spikes. §8.1 then constrains how: heavy animation
during a live run corrupts both the visuals and the numbers, so the
render path must not share a thread with either React or the measurement.

This is the phase where a project of this kind usually starts lying. A
particle field is much easier to write against a smooth invented signal
than against real samples arriving a few times a second, and nobody
looking at the screen can tell the difference. §5.7 forbids that, and the
architecture below is what makes it unnecessary.

## Decision

**Three threads, one direction of travel.**

1. **Measurement worker** — owns all timing (§5). Unchanged by this ADR.
2. **Main thread** — React, Framer Motion chrome, and the coalescing
   layer that batches worker events into at most one `setState` per
   animation frame.
3. **Render worker** — owns an `OffscreenCanvas` transferred to it, runs
   its own `requestAnimationFrame` loop, and draws the field.

Metrics flow main → render only, via `postMessage` (`render-protocol.ts`).
The render worker reports nothing back. A visual bug can therefore make
the page ugly; it cannot make a number wrong.

The canvas is **transferred**, not shared, so the main thread physically
cannot draw to it afterwards. The isolation is enforced by the platform
rather than by everyone remembering the rule.

**Interpolation is of the picture, never the data.** The worker keeps two
copies of the metrics — what was last measured, and what is currently
drawn — and eases the second toward the first each frame. Without it the
field jumps between discrete samples and reads as a broken animation.
The figure beside the field is rendered in the DOM straight from the
sample and never touches the eased value.

**Capability tiers** (`render-capability.ts`) throttle visuals only:

| Tier      | When                                            | Effect                            |
| --------- | ----------------------------------------------- | --------------------------------- |
| `full`    | default                                         | 60fps, up to 2,000 particles      |
| `reduced` | ≤4 cores or ≤4GB, when the device says so       | 30fps, 500 particles              |
| `static`  | `prefers-reduced-motion`, or no OffscreenCanvas | no animation; a bar, same numbers |

`prefers-reduced-motion` is treated as an instruction, not a hint. Someone
who gets motion sick from a moving particle field has said so, and "the
data is pretty" does not override them — they get every number, still.
A device that simply declines to report its specs is **not** demoted;
Safari reports neither figure, and absent is not the same as low.

## Consequences

- Measurement timing is structurally protected: the two heaviest jobs on
  the page never share a thread, and the render path has no route back
  into a result.
- The §8.1 merge gate (accuracy with visuals on vs off) is a real check
  rather than a formality, and is automated in
  `e2e/visuals-gate.spec.ts`.
- Every drawn quantity traces to a measurement: particle speed and
  density are throughput, direction is the phase, turbulence is jitter,
  the swell is loaded latency. Congestion of an unknown level draws as
  zero rather than inventing a swell (§5.7 rule 1).
- The field cannot render before the first real sample, so the opening
  moment of a run is deliberately empty rather than pre-seeded with
  motion.

## Deviation from §8, flagged rather than substituted

§8 specifies **WebGL** for the particle field. This ADR ships a **2D
canvas** field in the render worker instead. Per guardrail 7, that is
recorded here rather than quietly swapped:

- The constraint §8 gives for WebGL is that "Framer Motion animates DOM
  and will choke on thousands of particles". That reasoning rules out
  animating DOM nodes; it does not by itself rule out canvas 2D, and the
  §8.1 requirement it exists to protect — keeping the work off the main
  thread — is satisfied either way, because the field runs in a worker.
- At the current particle counts a 2D field is comfortable, and it is
  code whose correctness can actually be reviewed. A shader is the right
  call once the field wants tens of thousands of particles or genuine
  fluid behaviour, neither of which the present design uses.
- The protocol and worker boundary are unchanged by the switch, so
  moving to WebGL later replaces the draw call and nothing else.

**Open:** upgrade to WebGL if the field is to become a fluid simulation
rather than a particle stream, which is the version §8's "particle/fluid
field" wording most ambitiously implies.

## Alternatives rejected

- **rAF loop on the main thread.** Explicitly allowed by §8.1 as a
  fallback, rejected as the default: it puts the field in contention with
  React during exactly the seconds the numbers are being measured.
- **Animating particles as DOM nodes with Framer Motion.** The case §8
  already rejects. Framer Motion stays for chrome — layout transitions,
  spring roll-ups, phase choreography — which is what it is good at.
- **Driving the field from a smoothed or synthetic signal** so it always
  looks good. This is the tempting one, and it is the specific thing
  §5.7 exists to prevent.
