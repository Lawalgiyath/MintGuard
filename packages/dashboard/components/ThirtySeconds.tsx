"use client";

import { useState } from "react";

/**
 * The whole idea, in thirty seconds, with no vocabulary.
 *
 * Everything else on this page is evidence. This is comprehension. It exists because a
 * correct explanation that takes five minutes loses to a wrong one that takes thirty
 * seconds, and the honest way to win that race is not to talk faster — it is to let the
 * reader watch one of the two systems be wrong in front of them.
 *
 * There is no cryptography vocabulary in this component on purpose. No "Merkle", no
 * "precompile", no "encumbrance", no "aggregator interface". Someone who has never heard
 * of any of it should be able to press the button and understand what happened.
 *
 * The numbers are chosen so the punchline is exact rather than rhetorical: the headroom
 * gap between the two systems equals the announced withdrawal, to the dollar. Tokens
 * already issued stay comfortably backed in both columns, because the point being made
 * is about what may be issued NEXT — not about a system that is already insolvent.
 *
 * HONESTY: this is a fixed illustration with round numbers, and it says so plainly. It
 * is not reading a chain and does not pretend to. The live instrument below it is the
 * real thing. Blurring that line would undermine the one property this whole project is
 * built on, which is that you can check what we tell you.
 */

const VAULT = 1_000_000;
const ISSUED = 600_000;
const WITHDRAWAL = 300_000;

const money = (n: number) => "$" + n.toLocaleString("en-US");

export function ThirtySeconds() {
  const [announced, setAnnounced] = useState(false);

  // An ordinary check reports the money it can see sitting in the vault.
  const ordinaryBacking = VAULT;
  // MintBound stops counting money the moment its exit is announced.
  const provenBacking = announced ? VAULT - WITHDRAWAL : VAULT;

  const ordinaryHeadroom = ordinaryBacking - ISSUED;
  const provenHeadroom = provenBacking - ISSUED;

  return (
    <section className="panel thirty">
      <header className="panel-head">
        <div>
          <div className="label">The whole idea, in thirty seconds</div>
          <div className="thirty-sub">
            A vault holds {money(VAULT)}. Against it, {money(ISSUED)} of tokens have been
            issued. Two systems are watching that vault, deciding how many more may be
            issued.
          </div>
        </div>
        <span className="thirty-tag">ILLUSTRATION</span>
      </header>

      <div className="thirty-grid">
        <div className="thirty-col" data-state={announced ? "wrong" : "idle"}>
          <div className="thirty-name">An ordinary reserve check</div>
          <div className="thirty-num">{money(ordinaryHeadroom)}</div>
          <div className="thirty-cap">more tokens may be issued</div>
          <div className="thirty-verdict">
            {announced ? (
              <>
                <b>&ldquo;Everything is fine.&rdquo;</b>
                <br />
                It can still see {money(VAULT)} in the vault, so it still counts all of it.
              </>
            ) : (
              <>Sees {money(VAULT)} of backing.</>
            )}
          </div>
        </div>

        <div className="thirty-col" data-state={announced ? "right" : "idle"}>
          <div className="thirty-name">MintBound</div>
          <div className="thirty-num">{money(provenHeadroom)}</div>
          <div className="thirty-cap">more tokens may be issued</div>
          <div className="thirty-verdict">
            {announced ? (
              <>
                <b>&ldquo;{money(WITHDRAWAL)} of that is leaving.&rdquo;</b>
                <br />
                It stopped counting the moment the exit was announced.
              </>
            ) : (
              <>Proves {money(VAULT)} of backing.</>
            )}
          </div>
        </div>
      </div>

      <div className="thirty-foot">
        {announced ? (
          <>
            <p>
              The owner of the vault has announced they are taking {money(WITHDRAWAL)} out.
              The money has not moved yet — but it is spoken for.
            </p>
            <p>
              <b>
                Anyone trusting the left-hand number would issue {money(WITHDRAWAL)} of
                tokens backed by money that is already on its way out the door.
              </b>{" "}
              That is how holders of a token discover it was backed by nothing — not
              through fraud, but because nothing was watching the backing leave.
            </p>
            <p className="thirty-close">
              MintBound will not sign off on a single token past {money(provenHeadroom)}.
              Not because someone told it the money was leaving. Because it checked.
            </p>
            <button className="thirty-btn" onClick={() => setAnnounced(false)}>
              Start over
            </button>
          </>
        ) : (
          <>
            <p>
              Right now both systems agree, and both are correct. Watch what happens when
              the money starts to leave.
            </p>
            <button className="thirty-btn" data-primary onClick={() => setAnnounced(true)}>
              Announce a {money(WITHDRAWAL)} withdrawal
            </button>
          </>
        )}
      </div>
    </section>
  );
}
