import { TEAM_SIZES, type LobbyPlayerSnapshot, type LobbySnapshot, type Team } from '@zhb/shared';
import { useEffect, useState } from 'react';
import { useNetwork } from '../hooks/useNetwork.ts';
import { network } from '../services/network.ts';

const TEAM_LABEL: Record<Team, string> = { attackers: 'Attackers', defenders: 'Defenders' };

function byJoin(a: LobbyPlayerSnapshot, b: LobbyPlayerSnapshot): number {
  return a.joinedAt - b.joinedAt;
}

export function LobbyPage({ onLeft }: { onLeft: () => void }) {
  const { lobby, mySessionId, notice, status } = useNetwork();

  // Server notices (rule rejections) disappear on their own.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => network.clearNotice(), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  if (!lobby || !mySessionId) {
    return (
      <main className="panel">
        <p className="note" role="status">
          {status === 'reconnecting' ? 'Reconnecting to lobby…' : 'Not in a lobby.'}
        </p>
        <button className="btn" onClick={onLeft}>
          Back
        </button>
      </main>
    );
  }

  const me = lobby.players[mySessionId];
  const isHost = lobby.hostId === mySessionId;
  const players = Object.values(lobby.players).sort(byJoin);
  const slots = TEAM_SIZES[lobby.format];

  const leave = () => {
    void network.leave().then(onLeft);
  };

  return (
    <main className="lobby">
      <header className="lobby-head">
        <div>
          <p className="eyebrow">
            {lobby.mode.toUpperCase()} · {lobby.format.toUpperCase()} ·{' '}
            {lobby.visibility.toUpperCase()}
          </p>
          <h2>Lobby</h2>
        </div>
        <RoomCode lobby={lobby} />
      </header>

      {status === 'reconnecting' && (
        <p className="banner" role="status">
          Connection lost. Reconnecting…
        </p>
      )}
      {notice && (
        <p className="banner banner-warn" role="alert">
          {notice.message}
        </p>
      )}

      <div className="teams">
        {(['attackers', 'defenders'] as const).map((team) => {
          const members = players.filter((p) => p.team === team);
          const open = Math.max(0, slots - members.length);
          return (
            <section key={team} className={`team team-${team}`} aria-label={TEAM_LABEL[team]}>
              <h3>
                {TEAM_LABEL[team]}
                <span>
                  {members.length}/{slots}
                </span>
              </h3>
              <ul>
                {members.map((p) => (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    isMe={p.id === mySessionId}
                    isHost={p.id === lobby.hostId}
                  />
                ))}
                {Array.from({ length: open }, (_, i) => (
                  <li key={`open-${i}`} className="slot slot-open">
                    <span className="slot-name">Open slot</span>
                    {me && me.team !== team && lobby.phase === 'lobby' && (
                      <button className="btn btn-small" onClick={() => network.setTeam(team)}>
                        Join team
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="loadout">
        <span className="hud-label">LOADOUT</span> HX-27 Rifle{' '}
        <small>(only weapon available)</small>
      </p>

      <footer className="lobby-actions">
        {lobby.phase === 'lobby' && (
          <>
            {isHost ? (
              <button className="btn btn-primary" onClick={() => network.start()}>
                Start Match
              </button>
            ) : (
              <button
                className={`btn ${me?.ready ? 'btn-primary' : ''}`}
                aria-pressed={me?.ready ?? false}
                onClick={() => network.setReady(!me?.ready)}
              >
                {me?.ready ? 'Ready ✓' : 'Ready up'}
              </button>
            )}
            <button className="btn" onClick={leave}>
              Leave
            </button>
          </>
        )}
        {lobby.phase === 'starting' && (
          <p className="countdown" role="status" aria-live="polite">
            Match starting in {lobby.countdown}…
          </p>
        )}
        {lobby.phase === 'inMatch' && (
          <>
            <p className="note" role="status">
              Match started. In-match gameplay sync is not implemented yet (Phase 5b).
            </p>
            <button className="btn" onClick={leave}>
              Leave
            </button>
          </>
        )}
      </footer>
    </main>
  );
}

function PlayerRow({
  player,
  isMe,
  isHost,
}: {
  player: LobbyPlayerSnapshot;
  isMe: boolean;
  isHost: boolean;
}) {
  const state = !player.connected
    ? 'RECONNECTING'
    : isHost
      ? 'HOST'
      : player.ready
        ? 'READY'
        : 'NOT READY';
  return (
    <li className={`slot${isMe ? ' slot-me' : ''}`}>
      <span className="slot-name">
        {player.name}
        {isMe && <small> (you)</small>}
      </span>
      <span className="slot-gear">HX-27</span>
      <span
        className={`slot-state${player.ready || isHost ? ' is-ready' : ''}${
          player.connected ? '' : ' is-away'
        }`}
      >
        {state}
      </span>
    </li>
  );
}

function RoomCode({ lobby }: { lobby: LobbySnapshot }) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const invite = `${window.location.origin}${window.location.pathname}#/play/${lobby.roomCode}`;

  const copy = (what: 'code' | 'link') => {
    const text = what === 'code' ? lobby.roomCode : invite;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(what);
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <div className="room-code">
      <span className="hud-label">ROOM CODE</span>
      <span className="room-code-value" data-testid="room-code">
        {lobby.roomCode}
      </span>
      <span className="room-code-actions">
        <button className="btn btn-small" onClick={() => copy('code')}>
          {copied === 'code' ? 'Copied' : 'Copy code'}
        </button>
        <button className="btn btn-small" onClick={() => copy('link')}>
          {copied === 'link' ? 'Copied' : 'Copy invite link'}
        </button>
      </span>
    </div>
  );
}
