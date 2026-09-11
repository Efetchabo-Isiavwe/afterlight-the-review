import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import StartGame, { EventBus, EV } from './game/main';
import { CSS, GamePhase, INVESTIGATION } from './game/config';
import { BRIEFING_LINES, EVIDENCE, ENDINGS, SUSPECTS, EvidenceFile, Suspect } from './game/levels';
import { playSFX, setSoundMuted, isSoundMuted } from './game/audio';

export interface IRefPhaserGame {
    game: Phaser.Game | null;
    scene: Phaser.Scene | null;
}

type Tab = 'evidence' | 'intel' | 'telemetry';

function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);

    const [phase, setPhase] = useState<GamePhase>('TITLE');
    const [tab, setTab] = useState<Tab>('evidence');
    const [inspected, setInspected] = useState<string[]>([]);
    const [interviewed, setInterviewed] = useState<string[]>([]);
    const [selectedEvidence, setSelectedEvidence] = useState<EvidenceFile | null>(null);
    const [selectedSuspect, setSelectedSuspect] = useState<Suspect | null>(null);
    const [beatIndex, setBeatIndex] = useState(0);
    const [stress, setStress] = useState(0);
    const [briefLine, setBriefLine] = useState(0);
    const [crisisStabilized, setCrisisStabilized] = useState(false);
    const [crisisFailed, setCrisisFailed] = useState(false);
    const [ending, setEnding] = useState<(typeof ENDINGS)[number] | null>(null);
    const [muted, setMuted] = useState(false);

    const phaseRef = useRef(phase);
    phaseRef.current = phase;

    // Mount Phaser once
    const setPhaseBoth = useCallback((p: GamePhase) => {
        setPhase(p);
        EventBus.emit(EV.PHASE_CHANGED, { phase: p });
    }, []);

    // ---- Phaser mount (template bridge — do not remove) ----
    useLayoutEffect(() => {
        if (phaserRef.current === null) {
            const game = StartGame('game-container');
            phaserRef.current = { game, scene: null };
        }
        const handler = (scene: Phaser.Scene) => {
            if (phaserRef.current) phaserRef.current.scene = scene;
        };
        const onCrisis = (payload: { success: boolean }) => {
            setCrisisStabilized(payload.success);
            setCrisisFailed(!payload.success);
            setPhaseBoth('CRISIS_RESOLVED');
        };
        EventBus.on('current-scene-ready', handler);
        EventBus.on(EV.CRISIS_STABILIZED, onCrisis);
        return () => {
            EventBus.removeListener('current-scene-ready', handler);
            EventBus.removeListener(EV.CRISIS_STABILIZED, onCrisis);
            if (phaserRef.current) {
                phaserRef.current.game?.destroy(true);
                phaserRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const click = () => { playSFX('coin', 0.5); };

    const crisisUnlocked =
        inspected.length >= INVESTIGATION.crisisEvidenceThreshold &&
        interviewed.length >= INVESTIGATION.crisisInterviewThreshold;
    const boardUnlocked =
        inspected.length >= INVESTIGATION.totalEvidence &&
        interviewed.length >= INVESTIGATION.totalPersonnel &&
        crisisStabilized;

    // ---- Actions ----
    const openEvidence = (e: EvidenceFile) => {
        click();
        setSelectedEvidence(e);
        if (!inspected.includes(e.id)) {
            const next = [...inspected, e.id];
            setInspected(next);
            EventBus.emit(EV.EVIDENCE_INSPECTED, { evidenceId: e.id, count: next.length });
        }
    };

    const openSuspect = (s: Suspect) => {
        click();
        setSelectedSuspect(s);
        setBeatIndex(0);
        setStress(0);
    };

    const pressBeat = () => {
        if (!selectedSuspect) return;
        click();
        const beat = selectedSuspect.beats[beatIndex];
        if (!beat) return;
        setStress((v) => Math.min(100, v + beat.stress));
        setBeatIndex((i) => {
            const next = i + 1;
            if (next >= selectedSuspect.beats.length && !interviewed.includes(selectedSuspect.id)) {
                const arr = [...interviewed, selectedSuspect.id];
                setInterviewed(arr);
                EventBus.emit(EV.INTERVIEW_COMPLETED, { suspectId: selectedSuspect.id, count: arr.length });
            }
            return next;
        });
    };

    const triggerCrisis = () => {
        playSFX('hit', 0.7);
        setPhaseBoth('CRISIS_ACTIVE');
        EventBus.emit(EV.TRIGGER_CRISIS, { alertLevel: 'CRITICAL' });
    };

    const selectVerdict = (id: string) => {
        const e = ENDINGS.find((x) => x.id === id);
        if (!e) return;
        playSFX('win', 0.8);
        EventBus.emit(EV.BOARD_VERDICT_SELECTED, { verdictId: e.verdict, ending: e.id });
        setEnding(e);
        setPhaseBoth('ENDING');
    };

    const restartCase = () => {
        click();
        EventBus.emit(EV.RESTART_CASE, {});
        setInspected([]);
        setInterviewed([]);
        setSelectedEvidence(null);
        setSelectedSuspect(null);
        setBeatIndex(0);
        setStress(0);
        setBriefLine(0);
        setCrisisStabilized(false);
        setCrisisFailed(false);
        setEnding(null);
        setTab('evidence');
        setPhaseBoth('TITLE');
    };

    const toggleMute = () => {
        const m = !isSoundMuted();
        setSoundMuted(m);
        setMuted(m);
        if (phaserRef.current?.game) phaserRef.current.game.sound.mute = m;
    };

    // ---- Keyboard hotkeys ----
    useEffect(() => {
        const onKey = (ev: KeyboardEvent) => {
            const p = phaseRef.current;
            if (ev.key === 'Escape') {
                if (selectedEvidence) { setSelectedEvidence(null); return; }
                if (selectedSuspect) { setSelectedSuspect(null); return; }
                if (p === 'HOW_TO_PLAY' || p === 'CASE_BRIEFING') setPhaseBoth('TITLE');
                return;
            }
            if (ev.key === ' ' || ev.key === 'Enter') {
                ev.preventDefault();
                if (selectedSuspect && selectedSuspect.beats[beatIndex]) { pressBeat(); return; }
                if (p === 'TITLE' && ev.key === 'Enter') setPhaseBoth('HOW_TO_PLAY');
                if (p === 'CASE_BRIEFING') {
                    if (briefLine < BRIEFING_LINES.length - 1) setBriefLine((i) => i + 1);
                    else setPhaseBoth('TCC_HUB');
                }
                return;
            }
            if (p === 'TCC_HUB' && !selectedEvidence && !selectedSuspect) {
                if (ev.key === '1') setTab('evidence');
                if (ev.key === '2') setTab('intel');
                if (ev.key === '3') setTab('telemetry');
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSuspect, beatIndex, selectedEvidence, briefLine]);

    const progressPct = Math.round(((inspected.length + interviewed.length) / 16) * 100);

    return (
        <div id="app">
            <div id="game-container"></div>
            <div id="hud">
                {/* Mute toggle — always available */}
                <button id="mute-btn" onClick={toggleMute} aria-label="Toggle sound">
                    {muted ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={CSS.ivory} strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                    ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={CSS.gold} strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg>
                    )}
                </button>

                {/* ---------- TITLE ---------- */}
                {phase === 'TITLE' && (
                    <div className="overlay">
                        <div className="title-card">
                            <div className="title-kicker">FEDERAL MINISTRY OF POWER — INDEPENDENT AUDIT COMMISSION</div>
                            <h1 className="title-main">AFTERLIGHT</h1>
                            <div className="title-sub">CASE 01 — THE REVIEW</div>
                            <div className="title-buttons">
                                <button className="btn btn-gold btn-lg" onClick={() => { click(); setPhaseBoth('HOW_TO_PLAY'); }}>
                                    START CASE
                                </button>
                                <button className="btn btn-ghost" onClick={() => { click(); setPhaseBoth('HOW_TO_PLAY'); }}>
                                    HOW TO PLAY
                                </button>
                            </div>
                            <div className="title-foot">A cinematic psychological thriller investigation · Lagos · Abuja · Kano · Port Harcourt</div>
                        </div>
                    </div>
                )}

                {/* ---------- HOW TO PLAY ---------- */}
                {phase === 'HOW_TO_PLAY' && (
                    <div className="overlay">
                        <div className="panel panel-wide">
                            <h2 className="panel-title gold">TACTICAL ORIENTATION</h2>
                            <ul className="rules-list">
                                <li><b className="teal">EVIDENCE</b> — Review all 10 dossier files. Each inspection tags suspects it corroborates. Two classified files unlock only after the live crisis.</li>
                                <li><b className="teal">INTERROGATION</b> — Interview all 6 personnel. Press them for answers (SPACE / PRESS) — each press reveals more but raises their <b className="crimson">stress meter</b>.</li>
                                <li><b className="teal">CRISIS</b> — After enough coverage, a live grid cascade triggers. Tap the failing nodes on the telemetry canvas to stabilize load frequency before the alert timer expires.</li>
                                <li><b className="teal">BOARD REVIEW</b> — Unlocks when all evidence is reviewed, all personnel interviewed, and the crisis is stabilized. Your verdict selects one of four psychological endings.</li>
                                <li><b className="gold">CONTROLS</b> — Mouse/touch everywhere. Keys: <kbd>1-3</kbd> hub tabs · <kbd>SPACE</kbd> advance interrogation · <kbd>ESC</kbd> back · <kbd>ENTER</kbd> confirm.</li>
                            </ul>
                            <button className="btn btn-gold btn-lg" onClick={() => { click(); setPhaseBoth('CASE_BRIEFING'); }}>
                                PROCEED TO CASE BRIEFING
                            </button>
                        </div>
                    </div>
                )}

                {/* ---------- CASE BRIEFING ---------- */}
                {phase === 'CASE_BRIEFING' && (
                    <div className="overlay">
                        <div className="panel panel-wide briefing">
                            <h2 className="panel-title crimson">CASE BRIEFING — INCIDENT 08-LAGOS</h2>
                            <div className="briefing-lines">
                                {BRIEFING_LINES.slice(0, briefLine + 1).map((l, i) => (
                                    <p key={i} className={i === briefLine ? 'brief-line active' : 'brief-line'}>{l}</p>
                                ))}
                            </div>
                            {briefLine < BRIEFING_LINES.length - 1 ? (
                                <button className="btn btn-gold btn-lg" onClick={() => { click(); setBriefLine((i) => i + 1); }}>
                                    CONTINUE ▸
                                </button>
                            ) : (
                                <button className="btn btn-gold btn-lg pulse" onClick={() => { click(); setPhaseBoth('TCC_HUB'); }}>
                                    ACCEPT AUDIT COMMISSION
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* ---------- TCC HUB ---------- */}
                {phase === 'TCC_HUB' && !selectedEvidence && !selectedSuspect && (
                    <div className="overlay hub">
                        <div className="hub-top">
                            <div className="hub-title">TACTICAL COMMAND CENTER</div>
                            <div className="hub-progress">
                                <span>AUDIT COVERAGE {progressPct}%</span>
                                <div className="bar"><div className="bar-fill" style={{ width: `${progressPct}%` }} /></div>
                                <span className="dim">EVIDENCE {inspected.length}/{INVESTIGATION.totalEvidence} · INTERVIEWS {interviewed.length}/{INVESTIGATION.totalPersonnel}</span>
                            </div>
                        </div>

                        <div className="hub-tabs">
                            <button className={`tab ${tab === 'evidence' ? 'tab-on' : ''}`} onClick={() => { click(); setTab('evidence'); }}>1 · EVIDENCE DOSSIER</button>
                            <button className={`tab ${tab === 'intel' ? 'tab-on' : ''}`} onClick={() => { click(); setTab('intel'); }}>2 · INTERROGATION</button>
                            <button className={`tab ${tab === 'telemetry' ? 'tab-on' : ''}`} onClick={() => { click(); setTab('telemetry'); }}>3 · TELEMETRY GRID</button>
                        </div>

                        <div className="hub-body">
                            {tab === 'evidence' && (
                                <div className="card-grid">
                                    {EVIDENCE.map((e) => {
                                        const locked = e.postCrisis && !crisisStabilized;
                                        const done = inspected.includes(e.id);
                                        return (
                                            <button key={e.id} className={`card ${done ? 'card-done' : ''} ${locked ? 'card-locked' : ''}`}
                                                disabled={locked} onClick={() => openEvidence(e)}>
                                                <div className="card-id">{e.id}</div>
                                                <div className="card-name">{locked ? '▮▮▮ CLASSIFIED — POST-CRISIS ▮▮▮' : e.title}</div>
                                                <div className="card-class">{locked ? 'RESOLVE THE LIVE CRISIS TO DECRYPT' : e.classification}</div>
                                                {done && <div className="card-check gold">✓ REVIEWED</div>}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            {tab === 'intel' && (
                                <div className="card-grid">
                                    {SUSPECTS.map((s) => {
                                        const done = interviewed.includes(s.id);
                                        return (
                                            <button key={s.id} className={`card suspect ${done ? 'card-done' : ''}`} onClick={() => openSuspect(s)}>
                                                <div className="suspect-dot" style={{ background: s.accent }} />
                                                <div className="card-name" style={{ color: s.accent }}>{s.name}</div>
                                                <div className="card-class">{s.role}</div>
                                                {done && <div className="card-check gold">✓ INTERVIEWED</div>}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            {tab === 'telemetry' && (
                                <div className="telemetry-panel">
                                    <p className="dim">Live national telemetry renders on the tactical canvas behind this panel — radar sweep, node topology (Kano · Abuja · Port Harcourt · Lagos · Kainji · Egbin), and the audio-reactive frequency waveform.</p>
                                    {!crisisUnlocked && !crisisStabilized && (
                                        <p className="teal">◈ Anomaly detection requires more coverage: review ≥{INVESTIGATION.crisisEvidenceThreshold} evidence files and interview ≥{INVESTIGATION.crisisInterviewThreshold} personnel before the surge signature can be confirmed.</p>
                                    )}
                                    {crisisUnlocked && !crisisStabilized && (
                                        <button className="btn btn-crisis btn-lg pulse" onClick={triggerCrisis}>
                                            ⚠ CRISIS ALERT — GRID CASCADE DETECTED · ENGAGE EMERGENCY DIAGNOSTIC
                                        </button>
                                    )}
                                    {crisisStabilized && (
                                        <p className="teal">✓ CASCADE STABILIZED. Two post-crisis classified files (EV-09, EV-10) have been streamed to the Evidence Dossier.</p>
                                    )}
                                    {boardUnlocked && phase === 'TCC_HUB' && (
                                        <button className="btn btn-gold btn-lg pulse" onClick={() => { click(); setPhaseBoth('BOARD_REVIEW'); }}>
                                            ⚖ CONVENE 48-HOUR NATIONAL REVIEW BOARD
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ---------- EVIDENCE VIEWER ---------- */}
                {selectedEvidence && (
                    <div className="overlay">
                        <div className="panel panel-wide dossier">
                            <div className="dossier-head">
                                <span className="card-id">{selectedEvidence.id}</span>
                                <h2 className="panel-title gold">{selectedEvidence.title}</h2>
                                <span className="class-tag">{selectedEvidence.classification}</span>
                            </div>
                            <p className="dossier-summary">{selectedEvidence.summary}</p>
                            <p className="dossier-detail">{selectedEvidence.detail}</p>
                            <div className="corrob">
                                <span className="dim">CORROBORATES:</span>
                                {selectedEvidence.corroborates.map((id) => {
                                    const s = SUSPECTS.find((x) => x.id === id);
                                    return <span key={id} className="tag" style={{ borderColor: s?.accent, color: s?.accent }}>{s?.name ?? id}</span>;
                                })}
                            </div>
                            <div className="audit-note">▸ AUDIT NOTE: {selectedEvidence.note}</div>
                            <button className="btn btn-ghost" onClick={() => { click(); setSelectedEvidence(null); }}>
                                CLOSE (ESC)
                            </button>
                        </div>
                    </div>
                )}

                {/* ---------- INTERROGATION ROOM ---------- */}
                {selectedSuspect && (
                    <div className="overlay">
                        <div className="panel panel-wide interrogation">
                            <div className="inter-head">
                                <div>
                                    <h2 className="panel-title" style={{ color: selectedSuspect.accent }}>{selectedSuspect.name}</h2>
                                    <div className="card-class">{selectedSuspect.role}</div>
                                </div>
                                <div className="stress-box">
                                    <span className="dim">STRESS</span>
                                    <div className="bar stress-bar"><div className="bar-fill stress-fill" style={{ width: `${Math.max(0, Math.min(100, stress))}%` }} /></div>
                                    <span className={stress > 60 ? 'crimson' : 'gold'}>{stress}%</span>
                                </div>
                            </div>
                            <div className="inter-profile">
                                <p><b className="teal">PROFILE:</b> {selectedSuspect.profile}</p>
                                <p><b className="crimson">MOTIVE ANALYSIS:</b> {selectedSuspect.motive}</p>
                            </div>
                            <div className="inter-log">
                                {selectedSuspect.beats.slice(0, beatIndex).map((b, i) => (
                                    <p key={i} className="log-line" style={{ borderColor: selectedSuspect.accent }}>
                                        <b style={{ color: selectedSuspect.accent }}>{b.speaker}:</b> {b.text}
                                    </p>
                                ))}
                                {beatIndex >= selectedSuspect.beats.length && (
                                    <p className="log-done gold">✓ INTERVIEW COMPLETE — LOG FILED. Press ESC to return to the hub.</p>
                                )}
                            </div>
                            <div className="inter-buttons">
                                {beatIndex < selectedSuspect.beats.length ? (
                                    <button className="btn btn-gold btn-lg" onClick={pressBeat}>
                                        PRESS FOR ANSWERS (SPACE) — {selectedSuspect.beats.length - beatIndex} LEFT
                                    </button>
                                ) : (
                                    <button className="btn btn-ghost" onClick={() => { click(); setSelectedSuspect(null); }}>RETURN TO HUB (ESC)</button>
                                )}
                                <button className="btn btn-ghost" onClick={() => { click(); setSelectedSuspect(null); }}>EXIT</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ---------- CRISIS ACTIVE ---------- */}
                {phase === 'CRISIS_ACTIVE' && (
                    <div className="crisis-banner">
                        <span className="crimson blink">⚠ CRITICAL ALERT — KAINJI-EGBIN INTERTIE CASCADE ⚠</span>
                        <span className="dim">Tap the red failing nodes on the tactical canvas to stabilize load frequency</span>
                    </div>
                )}

                {/* ---------- CRISIS RESOLVED ---------- */}
                {phase === 'CRISIS_RESOLVED' && (
                    <div className="overlay">
                        <div className="panel panel-wide">
                            <h2 className={`panel-title ${crisisFailed ? 'crimson' : 'teal'}`}>
                                {crisisFailed ? 'CASCADE PARTIALLY CONTAINED' : 'GRID CASCADE STABILIZED'}
                            </h2>
                            {crisisFailed ? (
                                <p>The alert timer expired before all nodes were locked. Emergency crews contained the surge manually — at a cost. Two classified files remain sealed in the cascade debris: <b className="gold">EV-09 Routing Exception Report</b> and <b className="gold">EV-10 Executive Override Trace</b>. Re-run the diagnostic and achieve full stabilization to decrypt them.</p>
                            ) : (
                                <p>All failing nodes locked. Load frequency nominal. As the cascade subsided, the telemetry layer streamed two classified files recovered from the live surge: <b className="gold">EV-09 Routing Exception Report</b> and <b className="gold">EV-10 Executive Override Trace</b>. Further investigation is now unlocked.</p>
                            )}
                            <div className="title-buttons">
                                {crisisFailed && !crisisStabilized && (
                                    <button className="btn btn-crisis" onClick={triggerCrisis}>RE-RUN EMERGENCY DIAGNOSTIC</button>
                                )}
                                <button className="btn btn-gold btn-lg" onClick={() => { click(); setPhaseBoth('TCC_HUB'); }}>
                                    RETURN TO COMMAND CENTER
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ---------- BOARD REVIEW ---------- */}
                {phase === 'BOARD_REVIEW' && (
                    <div className="overlay">
                        <div className="panel panel-wide">
                            <h2 className="panel-title gold">⚖ 48-HOUR NATIONAL REVIEW BOARD</h2>
                            <p className="dim">The chamber is silent. Fourteen million citizens await your finding. Select the strategic conclusion of your audit — this decision is final.</p>
                            <div className="verdict-grid">
                                {ENDINGS.map((e) => (
                                    <button key={e.id} className="verdict-card" onClick={() => selectVerdict(e.id)}>
                                        <div className="verdict-id gold">FINDING {e.id}</div>
                                        <div className="verdict-text">{e.verdict}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ---------- ENDING ---------- */}
                {phase === 'ENDING' && ending && (
                    <div className="overlay">
                        <div className={`panel panel-wide ending ${ending.id === 'D' ? 'ending-violet' : ''}`}>
                            <h2 className={`panel-title ${ending.id === 'D' ? 'violet' : 'gold'}`}>{ending.title}</h2>
                            <div className="ending-body">
                                {ending.body.map((p, i) => <p key={i} className={p.startsWith('>') ? 'nexus-line' : ''}>{p}</p>)}
                            </div>
                            {ending.twist && <div className="twist">“{ending.twist}”</div>}
                            <button className="btn btn-gold btn-lg" onClick={restartCase}>
                                ⟲ RESTART CASE
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;