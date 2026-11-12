# Brawlverse — Final plan

Status as of 2026-11-11. This is the build blueprint that `plan.md` asks for. Items marked **(built)** exist in the repo; everything else is the plan.

## 1. What Brawlverse is

An original 3D platform brawler that runs in the browser. Fighters take damage as a percentage, and the higher it gets the further they fly; a stock is lost when a fighter leaves the blast zone. All characters, stages, art, music and names are original to Brawlverse — the genre is shared with other platform fighters, the content is not.

Launch scope: 4 fighters (Kael, Nyx, Bramm, Zephra), 4 stages (Cinder Forge, Neon Abyss, Sunken Colosseum, Frostspire Summit), local 2-player, and online Play with a Friend.

## 2. Repo layout

| Path | Purpose |
| :-- | :-- |
| `index.html`, `src/` | Landing page **(built)** — Vite, Three.js, GSAP ScrollTrigger, Lenis |
| `public/media`, `public/frames` | Delivery images and the 116-frame hero sequence **(built)** |
| `media-src/flow` | Masters from Google Flow: stills and `hero_transition.mp4` **(built)** |
| `game/` | Playable runtime (next) — served at `/play` |
| `server/` | Room/signalling worker (next) |
| `Plan/assets/` | Git-ignored reference material. Not shipped: it is third-party game content and must not appear in the product. |

## 3. Game architecture

- **Simulation:** fixed 60 Hz step, fully deterministic, separate from rendering. State is plain data (positions, velocities, damage, stocks, action state, frame counters) so it can be copied and restored cheaply — rollback depends on this.
- **Math:** fixed-point or integer sub-pixel positions inside the sim. Floats differ across browsers and CPUs and cause desyncs; Three.js only reads sim state to draw it.
- **Collision:** gameplay is 2D on a 3D-rendered plane. Stages are axis-aligned boxes and pass-through platforms; fighters use capsule hurtboxes and per-move hitbox circles defined in frame data. No general physics engine.
- **Combat:** knockback = base + damage × growth, scaled by fighter weight; hitstun and hitlag derived from knockback; ledge grab, shield, dodge, double jump. Move data lives in JSON per fighter (startup / active / recovery frames, hitboxes, angle, knockback).
- **Rendering:** Three.js `WebGLRenderer` first. `WebGPURenderer` is reported as production-ready with automatic WebGL 2 fallback, but its API is still moving, so adopt it later behind a flag with a pinned Three.js version.
- **Assets:** `.glb` with Draco/Meshopt geometry and KTX2 textures; one skeleton and animation set per fighter; target ≤ 3 MB per fighter and ≤ 6 MB per stage.
- **Camera:** frames all fighters with smoothed zoom and pan; shake and hit-stop on heavy hits.
- **Performance budget:** 60 fps on a mid-range laptop iGPU; ≤ 150 draw calls; one shadow-casting light; DPR capped at 1.75.

## 4. Play with a Friend

- **Flow:** "Create room" → 5-character code and link → friend opens the link → both pick fighters → fight. No accounts.
- **Transport:** WebRTC DataChannel, peer-to-peer, unordered and unreliable (UDP-like), carrying only inputs.
- **Netcode:** rollback. Each client runs the sim immediately on local input plus predicted remote input, and re-simulates when real input arrives. Start at 2 frames of input delay and up to 8 frames of rollback. Send the last several frames of input in every packet to ride out loss. Exchange a state checksum every second to detect desync.
- **Signalling:** a small WebSocket room service that only relays offers, answers and ICE candidates, then steps aside.
- **NAT traversal:** public STUN, plus a TURN relay for the minority of connections that cannot go direct.
- **Fallback:** if peer-to-peer fails, relay inputs through the room WebSocket; playable, with more delay.
- **Local play:** two players on one keyboard or two gamepads, same sim, no network.
- **Prior art:** NetplayJS and the `rollback-netcode` TypeScript library both pair rollback with WebRTC in the browser. Useful as references; we own the sim, so the rollback loop will be in-house.

## 5. Deployment

| Piece | Choice | Why |
| :-- | :-- | :-- |
| Site and game client | Cloudflare Pages (static Vite build) | Free tier, global CDN, preview deploy per branch |
| Rooms / signalling | Cloudflare Durable Objects (via PartyKit-style room class) | One object per room, WebSockets, no server to run |
| TURN | Cloudflare Realtime TURN | Same account; verify current free allowance before launch |
| Large media | Pages for now; move frames, video and `.glb` to R2 if the repo passes ~100 MB | Keeps git light |
| CI | GitHub Actions: build on PR, deploy `main` | Repo is `satiricalguru/Brawlverse` |

Alternative considered: Colyseus on a VPS gives an authoritative server and matchmaking, but costs a running machine and adds latency a 1v1 friend match does not need.

Not yet verified: Cloudflare TURN pricing and Durable Objects free-tier limits. Confirm both in the Cloudflare docs before committing.

## 6. Content pipeline

1. **Key art** — Google Flow image mode (Nano Banana) **(done for 4 fighters, 4 stages, hero)**. `plan.md` names ChatGPT for images; Flow was used here because the hero video needed start and end frames in the same project. Turnaround sheets for 3D can come from either.
2. **Base meshes** — Tripo 3D Studio from turnaround sheets.
3. **Cleanup** — Blender via MCP: retopo, scale, rig to shared skeleton, PBR, export `.glb`.
4. **Runtime** — Three.js loaders, per-fighter move data.
5. **Cinematics** — Google Flow / Veo only **(hero reveal done)**.

## 7. Milestones

1. Landing page **(built, not deployed)**.
2. Grey-box sim: one stage, one capsule fighter, local 2-player, knockback and stocks.
3. Fighter 1 end to end through the pipeline (Kael), with full move set.
4. Rollback over WebRTC with room codes.
5. Remaining three fighters and four stages.
6. HUD, audio, menus, results screen.
7. Deploy, then playtest over real connections and tune delay/rollback.

## 8. Sources

- Rollback and WebRTC in the browser: [NetplayJS](https://awesome.ecosyste.ms/projects/github.com%2Frameshvarun%2Fnetplayjs), [webrtc-pong](https://github.com/mitxela/webrtc-pong), [rollback-netcode](https://1clonegithubbyxjn.1934672944.workers.dev/someusername6/rollback-netcode), [How rollback works](https://bymuno-dot-com.pages.dev/post/rollback)
- Three.js renderer status: [WebGPU migration guide](https://www.utsubo.com/blog/webgpu-threejs-migration-guide), [100 Three.js tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- Hosting options: [Multiplayer browser game guide](https://app.cinevva.com/guides/multiplayer-browser-game), [Durable Objects alternatives](https://ably.com/alternatives/cloudflare-durable-objects)
- Layout reference for the stage selector (pattern only, no content used): https://www.smashbros.com/en_US/stage/
