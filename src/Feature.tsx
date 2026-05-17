import { useEffect, useMemo, useRef } from "react";
import {
  Leaderboard,
  createClockSync,
  useEventLog,
  useMeshSlot,
  useNamedPeer,
  usePhase,
  type MeshConfig,
  type YRoom,
} from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };
type Clap = { round: number; peerId: string; target: string; ts: number };
type Phase = "lobby" | "round" | "between" | "done";

export function Feature({ room, config }: Props) {
  if (!room) {
    return (
      <div className="clap-screen">
        <h1>applause bracket</h1>
        <p className="clap-status">Connecting…</p>
      </div>
    );
  }
  return <Body room={room} config={config} />;
}

function Body({ room, config }: { room: YRoom; config: MeshConfig }) {
  const { name, setName, names, myName } = useNamedPeer(config, room);
  const ph = usePhase<Phase>(room, "phase", "lobby");
  const log = useEventLog<Clap>(room, "claps");

  const clock = useMemo(() => (room ? createClockSync(room.provider) : null), [room]);
  useEffect(() => () => clock?.destroy(), [clock]);
  const slot = useMeshSlot(clock, 15_000);

  const phaseMap = room.doc.getMap<string | number>("phase");
  const elimMap = room.doc.getMap<string>("eliminations");

  // re-render on eliminations updates
  const lastSeenRound = useRef<number>(-1);
  useEffect(() => {
    const cb = () => (lastSeenRound.current = lastSeenRound.current); // noop, but observe re-renders via phase/log hooks
    elimMap.observe(cb);
    return () => elimMap.unobserve(cb);
  }, [elimMap]);

  const contestantsRaw = phaseMap.get("contestants") as string | undefined;
  const contestants: string[] = contestantsRaw ? JSON.parse(contestantsRaw) : [];
  const baselineSlot = (phaseMap.get("baselineSlot") as number | undefined) ?? slot.slotId;
  const currentRound = Math.max(0, slot.slotId - baselineSlot);

  const eliminated: string[] = [];
  elimMap.forEach((v) => {
    if (typeof v === "string") eliminated.push(v);
  });
  const alive = contestants.filter((c) => !eliminated.includes(c));

  // round advance: tally prev-round and eliminate lowest
  useEffect(() => {
    if (ph.phase !== "round") {
      lastSeenRound.current = -1;
      return;
    }
    if (currentRound <= lastSeenRound.current) return;
    lastSeenRound.current = currentRound;
    if (currentRound === 0) return; // first round in progress
    const prev = currentRound - 1;
    if (elimMap.has(String(prev))) return;
    if (alive.length <= 1) return;
    const counts = new Map<string, number>();
    alive.forEach((c) => counts.set(c, 0));
    for (const c of log.events) {
      if (c.round === prev && counts.has(c.target)) {
        counts.set(c.target, (counts.get(c.target) ?? 0) + 1);
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    const loser = sorted[0]?.[0];
    if (!loser) return;
    room.doc.transact(() => {
      elimMap.set(String(prev), loser);
    });
    const remaining = alive.filter((c) => c !== loser);
    if (remaining.length <= 1) {
      ph.transition("done", { from: "round" });
    }
  }, [currentRound, ph.phase, alive.length]);

  const startContest = () => {
    const present = new Set<string>();
    Object.values(names).forEach((n) => {
      if (n && n.trim()) present.add(n.trim());
    });
    if (present.size < 2) return;
    room.doc.transact(() => {
      if (!phaseMap.get("contestants")) {
        phaseMap.set("contestants", JSON.stringify([...present].sort()));
        phaseMap.set("baselineSlot", slot.slotId);
      }
    });
    ph.transition("round", { from: "lobby" });
  };

  const clap = (target: string) => {
    if (ph.phase !== "round") return;
    if (!alive.includes(target)) return;
    if (target === myName) return;
    log.push({ round: currentRound, peerId: room.peerId, target, ts: Date.now() });
  };

  const reset = () => {
    room.doc.transact(() => {
      phaseMap.delete("contestants");
      phaseMap.delete("baselineSlot");
      elimMap.forEach((_v, k) => elimMap.delete(k));
      log.clear();
    });
    ph.transition("lobby");
  };

  // per-target counts for current round
  const roundCounts = new Map<string, number>();
  for (const c of log.events) {
    if (c.round === currentRound) {
      roundCounts.set(c.target, (roundCounts.get(c.target) ?? 0) + 1);
    }
  }
  // cumulative for leaderboard
  const totals = new Map<string, number>();
  for (const c of log.events) totals.set(c.target, (totals.get(c.target) ?? 0) + 1);
  const items = [...totals.entries()]
    .map(([n, score]) => ({ id: n, name: n, score }))
    .sort((a, b) => b.score - a.score);

  const winner = ph.phase === "done" ? alive[0] : undefined;
  const present = room.peerCount + 1;

  return (
    <div className="clap-screen" data-phase={ph.phase}>
      <header className="clap-header">
        <h1>applause bracket</h1>
        <p className="clap-status">
          <span className="clap-chip">{ph.phase}</span>
          {ph.phase === "round" && <span> · round {currentRound + 1}</span>}
          <span>
            {" "}
            · {present} peer{present === 1 ? "" : "s"}
          </span>
        </p>
      </header>

      <div className="clap-name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="your name"
          maxLength={48}
          aria-label="your name"
        />
      </div>

      {ph.phase === "lobby" && (
        <button type="button" className="clap-start" onClick={startContest}>
          start the contest
        </button>
      )}

      {(ph.phase === "round" || ph.phase === "done") && (
        <div className="clap-grid" role="group" aria-label="contestants">
          {(ph.phase === "done" ? contestants : alive).map((c) => {
            const isOut = eliminated.includes(c);
            const disabled = isOut || ph.phase !== "round" || c === myName;
            return (
              <div key={c} className="clap-card" data-contestant={c} data-out={isOut ? "1" : "0"}>
                <p className="clap-name-row">
                  {c}
                  {c === myName && " (you)"}
                </p>
                <p className="clap-count">{roundCounts.get(c) ?? 0}</p>
                <button
                  type="button"
                  className="clap-tap"
                  disabled={disabled}
                  onClick={() => clap(c)}
                >
                  clap for {c}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {ph.phase === "round" && (
        <div className="clap-progress" aria-hidden="true">
          <div className="clap-progress-fill" style={{ width: `${slot.progress * 100}%` }} />
        </div>
      )}

      {elimMap.size > 0 && (
        <ol className="clap-bracket">
          {[...elimMap.entries()]
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([r, who]) => (
              <li key={r}>
                Round {Number(r) + 1}: {who} eliminated
              </li>
            ))}
        </ol>
      )}

      {ph.phase === "done" && winner && (
        <p className="clap-winner">
          winner: <strong>{winner}</strong>
        </p>
      )}

      <Leaderboard items={items} title="cumulative claps" highlightId={room.peerId} />

      {(ph.phase === "done" || ph.phase === "round") && (
        <button type="button" className="clap-reset" onClick={reset}>
          new contest
        </button>
      )}
    </div>
  );
}
