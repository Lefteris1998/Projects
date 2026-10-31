# 🐪 Aura Tax

An online board game for 2–8 players about champ smurf camel riders.
Ride around the desert, T-bag people to steal their aura, and once you've stolen enough, put them under **aura tax** so they have to pay you to duo q.
Just watch out for the booster on the enemy team, because getting destroyed in front of your duo puts you straight into the **Deathnote**, and if your aura goes below 0 you are out.

Things are not looking good for you lil bro.

## How to play

There is one lobby. Everyone who opens the site lands in it, anyone can change the settings and anyone can hit start. People who show up while a game is running spectate and get a seat in the next one.

- Everyone starts at the **Smurf Queue** with 50 aura and **3 cards** (2 Guard, 1 Attack). You can hold 5: go over and you have to throw cards away before your next move. Every time you ride past the Smurf Queue you get +20 aura.
- There is no turn timer: your turn lasts until you press End turn.
- **Two decks** sit in the middle of the board. **Guard** holds movement, reactions and utility. **Attack** holds steals, sabotage and the legendaries. Drawing is never automatic: you click the deck you want.
- **Your turn** has 3 steps, shown in the turn bar at the bottom of the screen: **draw** a card from either deck, **roll** the die, then **play a card or end your turn**. Rolling and playing a card each use one of your **moves** (2 a turn; Second Wind and Camel Zoomies give more). The bar always lights up the one button for your next step.
- **Cards** (one copy each, doubled with 5+ players): movement (Ride 2/3/4, Lag Switch, Camel Charge, Zoomies, Retreat, Back to Spawn), boosts (Touch Grass, Hidden MMR, Second Wind), steal (Emote Spam, Clip It, Diffed, Tax Audit, Hire a Booster, Camel Kick, Spam Ping, Leak DMs, Ghost Ping, Flame), social (Duo Invite, Betrayal, Deathnote Entry, Swap Places, Snitch, Server Vote) and legendaries (Champ Smurf Ascension, Duo Q with Booster, Mass Report, The Booster Himself).
- **Reactions** (Dodge, Uno Reverse, Report, Smurf Account, Screenshot) are played off-turn. When someone targets or T-bags you, you get 6 seconds to throw one back. Anyone can Report any card.
- **T-bag**: land on another rider to steal 15 aura from them.
- **Aura Tax**: steal 40 aura in total from the same rider and they pay you 6 aura at the start of each of their turns, until they steal from you or play Betrayal.
- **Board**: Patch Notes give you 2 draws, the Card Shop sells cards (15 from either deck, a legendary for 40), the Oasis gives a draw from the Guard deck, Osoka's Server Deathnotes you and makes you discard a random card, and Camel Zoomies gives +1 action and another roll. Booster Ambush, Ranked 1v1, Sandstorm and the Tax Office work as before.
- Going below 0 aura knocks you **out**: you lose your cards and turns and can only watch. If only one rider is left, they win.
- Otherwise the first rider to reach the target aura wins (default 150). If nobody does, the richest rider still in after the last round wins (default 10 rounds).

Disconnected riders go on camel autopilot (they roll and end their turn). Reopening the site in the same browser hands control back to them.

### Controls

| | Desktop | Phone / tablet |
|---|---|---|
| Read a card | Hover it | Tap it: it opens big, swipe for the rest of your hand |
| Play a card | Click it, then pick a target in the turn bar | Tap it, then pick a target in the card sheet |
| Pick a rider as a target | Click their button, or the rider on the board | Same, tap |
| Tile info | Hover a tile | Tap a tile |
| Turn the camera | Drag | Drag with one finger |
| Zoom / slide | Wheel / right-drag | Pinch / two fingers |
| Reset the camera | Double-click | Double-tap |
| Roll | Space or Enter | |

On phones the players are a strip along the top (tap it for the full list), and music, sound and the end game / leave buttons live in the ☰ menu. The game works upright and sideways, keeps the screen awake during a game, buzzes when it's your turn or someone comes for you, and flags the browser tab when you're needed.

## Run locally

```bash
npm install
npm start
# open http://localhost:3001
```

To test multiplayer on one machine, open a second browser profile or a private window. Each browser counts as one rider. To try it on your phone, connect it to the same Wi-Fi and open `http://<your computer's local IP>:3001` (allow Node through the firewall if it asks).

On the machine running the server there's a debug menu (the bug button, or the <kbd>`</kbd> key) with sound and sticker previews and a few cheats.

## Deploy on Render

1. Push this folder to a GitHub repo.
2. On [Render](https://render.com), click **New → Web Service** and pick the repo.
3. Set **Runtime** to `Node`, **Build Command** to `npm install` and **Start Command** to `npm start`.
4. Deploy, then share the URL. Everyone who opens it lands in the same lobby.

There is also a `render.yaml`, so you can use **New → Blueprint** to set it up in one click.

Notes:
- Render's free tier sleeps after about 15 minutes of inactivity, so the first visit after that takes ~30 seconds to wake up.
- The game lives in server memory, so a redeploy or restart ends a game in progress.

## Tech

- `server.js`: Express plus Socket.IO. The server is authoritative and holds all game logic (the lobby, turns, cards and reactions, aura economy, timers). Hands are private: each rider only receives their own cards.
- `public/`: plain HTML, CSS and JS with no build step. Socket.IO's client script is served by the server.
- `public/clay.js`, `clay-core.js`, `clay-worker.js`: the champions are sculpted from signed distance fields (shapes blended like clay, carved, roughened, painted) and meshed in web workers. Meshes are cached, and a colour change only recolours the existing mesh. `public/anatomy.js` holds the shared sculpted heads, hands, arms, legs and shoes; `public/champions.js` builds each champion from them.
