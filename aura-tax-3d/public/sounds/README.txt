Sticker pictures live in stickers/<sticker id>/: a .gif (or .png, .webp, .jpg) shows instead of the
icon, in the sticker menu and above the player. If there are several, the first one alphabetically is used.
Stickers have no sound.

Sticker ids: sleep, lel, zulul, c9, gulp, haha, ez, pants

T-bag sounds live in tbag/<champion id>/. Any .mp3, .wav, .ogg or .m4a in a champion's folder can play
when that champion T-bags someone (one is picked at random). Champions with an empty or missing folder
use tbag/default/. No restart needed: the game re-reads the folders.

Champion ids: camel, cactus, mrx, viking, dragon, penguin, frostking, crone, captain, pistol, buzzsaw,
dog, jetpack, hotdog, sensei, leech, ronin, poop

The starter sounds are synthesized by tools/make-tbag-sfx.js. Delete or replace them freely; the script
only writes files that are missing.
