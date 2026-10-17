// Spotify Web Playback SDK integration.
// The browser registers itself as a Spotify Connect device; actual playback
// control (play/pause/next/previous/volume/...) is routed through the backend,
// which calls the Spotify Web API directly — see spotifyControl().

let spotifyPlayerInstance = null;
let spotifyDeviceId = null;
let spotifyPlayerReady = false;
let spotifyPlayerConnecting = false;

async function fetchSpotifyStatus() {
    try {
        const response = await fetch('/spotify/api/status/');
        return await response.json();
    } catch (error) {
        console.error('Error fetching Spotify status:', error);
        return { success: false, connected: false };
    }
}

async function fetchSpotifyAccessToken() {
    const response = await fetch('/spotify/api/token/');
    const data = await response.json();
    if (!data.success) {
        throw new Error(data.message || 'Spotify is not connected');
    }
    return data.access_token;
}

async function spotifyControl(action, value) {
    try {
        const response = await fetch('/spotify/api/control/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, value })
        });
        return await response.json();
    } catch (error) {
        console.error('Error sending Spotify control command:', error);
        return { success: false, message: error.message };
    }
}

async function registerSpotifyDevice(deviceId) {
    try {
        await fetch('/spotify/api/device/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId })
        });
    } catch (error) {
        console.error('Error registering Spotify device:', error);
    }
}

// Explicit user pick from the device list (see widget.js) — persists for the
// tab's lifetime so a later SDK 'ready' event (e.g. after a network blip)
// doesn't silently steal control back to this browser.
async function selectSpotifyDevice(deviceId) {
    sessionStorage.setItem('spotifyManualDeviceId', deviceId);
    await registerSpotifyDevice(deviceId);
}

// Creates (or reconnects) our Web Playback SDK device if we don't already
// have a working one. Safe to call repeatedly — e.g. every time the music
// panel is opened — since it no-ops when a ready instance already exists,
// so it won't spawn duplicate "Archie Web Player" ghost devices.
async function ensureSpotifyPlayerConnected() {
    if (spotifyPlayerReady || spotifyPlayerConnecting) {
        return;
    }
    if (typeof Spotify === 'undefined') {
        // SDK script hasn't finished loading yet; onSpotifyWebPlaybackSDKReady
        // will call us once it has.
        return;
    }

    const status = await fetchSpotifyStatus();
    if (!status.connected) {
        return;
    }

    // A previous attempt (e.g. after an auth error) left a dead instance —
    // drop it before creating a fresh one.
    if (spotifyPlayerInstance) {
        spotifyPlayerInstance.disconnect();
        spotifyPlayerInstance = null;
    }

    spotifyPlayerConnecting = true;

    const player = new Spotify.Player({
        name: 'Archie Web Player',
        getOAuthToken: (callback) => {
            fetchSpotifyAccessToken()
                .then(callback)
                .catch((error) => console.error('Error getting Spotify token:', error));
        },
        volume: 0.5
    });

    player.addListener('ready', ({ device_id }) => {
        spotifyDeviceId = device_id;
        spotifyPlayerReady = true;
        spotifyPlayerConnecting = false;
        // Don't steal control back to this browser if the user manually
        // picked a different Spotify Connect device (e.g. their phone).
        if (!sessionStorage.getItem('spotifyManualDeviceId')) {
            registerSpotifyDevice(device_id);
        }
    });

    player.addListener('not_ready', () => {
        spotifyPlayerReady = false;
    });

    player.addListener('player_state_changed', (state) => {
        window.dispatchEvent(new CustomEvent('spotify:state', { detail: state }));
    });

    player.addListener('initialization_error', ({ message }) => {
        console.error('Spotify init error:', message);
        spotifyPlayerConnecting = false;
    });
    player.addListener('authentication_error', ({ message }) => {
        console.error('Spotify auth error:', message);
        spotifyPlayerConnecting = false;
    });
    player.addListener('account_error', ({ message }) => {
        console.error('Spotify account error:', message);
        spotifyPlayerConnecting = false;
    });

    player.connect();
    spotifyPlayerInstance = player;
}

window.onSpotifyWebPlaybackSDKReady = () => {
    ensureSpotifyPlayerConnected();
};

// Cleanly disconnect our SDK device on tab close/reload so it doesn't linger
// as a stale "Archie Web Player" entry in Spotify's device list.
window.addEventListener('pagehide', () => {
    if (spotifyPlayerInstance) {
        spotifyPlayerInstance.disconnect();
    }
});
