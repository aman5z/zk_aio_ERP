// ============================================================
//  voip.js — Employee-to-employee WebRTC calling
//  Signaling: server Socket.IO  (flask-socketio, no Asterisk)
//  Identity:  same badge/username as messaging feature
//  Depends on: socket.io-client (CDN), shared.js (STATE, toast, el, zkAPI)
// ============================================================

'use strict';

/* ── Constants ──────────────────────────────────────────────── */
// Populated from /api/voip/status on connect; fallback to Google STUN only
var VOIP_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

/* ── State ─────────────────────────────────────────────────── */
var _sio           = null;   // socket.io client socket
var _rtc           = null;   // RTCPeerConnection
var _localStream   = null;   // MediaStream (microphone)
var _remoteStream  = null;   // remote audio
var _remoteAudio   = null;   // <audio> element for remote
var _activeCallId  = null;
var _activePeer    = null;   // username of the other party (for ICE routing)
var _callMuted     = false;
var _callTimer     = null;
var _callStart     = null;
var _ringtone      = null;   // {stop()}
var _voipOnline    = [];     // [{username, name, badge, dept}] from server
var _voipContacts  = [];     // all contacts (online merged with employee list)
var _voipEnabled   = false;  // true once server confirms socketio available

/* Delay before auto-connect — lets page fully initialise first */
const VOIP_AUTO_CONNECT_DELAY_MS = 2500;

// ============================================================
//  INITIALIZATION & CONNECTION
// ============================================================

function voipInit() {
  if (_sio && _sio.connected) return; // already connected

  if (_sio) {
    // Socket exists but is not connected (disconnected / errored).
    // Clean it up so we can create a fresh connection below.
    try { _sio.disconnect(); } catch(e) { console.warn('[VoIP] cleanup disconnect error:', e); }
    _sio = null;
  }

  // Check if Socket.IO client library is present
  if (typeof io === 'undefined') {
    console.warn('[VoIP] socket.io-client not loaded — VoIP disabled');
    _voipSetStatus('● Unavailable', 'var(--text2)');
    return;
  }

  // Check if server has voip enabled
  fetch(CFG.zkUrl+'/api/voip/status').then(function(r){ return r.json(); }).then(function(d){
    if (!d.enabled) {
      _voipSetStatus('● Disabled — install flask-socketio', 'var(--yellow)');
      _voipShowInstallHint();
      return;
    }
    if (Array.isArray(d.ice_servers) && d.ice_servers.length) {
      VOIP_ICE_SERVERS = d.ice_servers;
    }
    _voipEnabled = true;
    _voipConnect();
  }).catch(function(){
    // Server might be running without the endpoint — still try
    _voipEnabled = true;
    _voipConnect();
  });
}

function _voipConnect() {
  var me = _voipMe();
  if (!me) {
    // Not logged in yet — retry in a bit
    setTimeout(_voipConnect, 3000);
    return;
  }

  _voipSetStatus('◌ Connecting…', 'var(--yellow)');

  // Use the same server URL as all other API calls (CFG.zkUrl already handles
  // the localhost→page-origin remapping for Cloudflare/remote access).
  // WebSocket-first: more reliable through Cloudflare tunnels than long-polling.
  // timeout: give up after 15 s so status falls to "● Error" instead of hanging.
  var sioUrl = (window.CFG && CFG.zkUrl) ? CFG.zkUrl : window.location.origin;
  _sio = io(sioUrl, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    timeout: 15000,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000
  });

  _sio.on('connect', function() {
    _voipSetStatus('◌ Registering…', 'var(--yellow)');
    var empInfo = _voipMeInfo();
    _sio.emit('voip_register', {
      username : me,
      name     : empInfo.name,
      badge    : empInfo.badge,
      dept     : empInfo.dept
    });
  });

  _sio.on('disconnect', function() {
    _voipSetStatus('● Offline', 'var(--text2)');
    _voipOnline = [];
    _voipRenderContacts();
  });

  _sio.on('connect_error', function(e) {
    _voipSetStatus('● Error', 'var(--red)');
    console.warn('[VoIP] connection error:', e.message);
  });

  // ── Server → client events ──────────────────────────────
  _sio.on('voip_online_update', function(data) {
    _voipOnline = Array.isArray(data.users) ? data.users : [];
    _voipSetStatus('● Online  ' + _voipOnline.length + ' peer' + (_voipOnline.length === 1 ? '' : 's'), 'var(--green)');
    _voipRenderContacts();
  });

  _sio.on('voip_calling', function(data) {
    // Our outbound call was accepted by server — waiting for callee
    // UI already shows "Calling…" state
    _activeCallId = data.call_id;
  });

  _sio.on('voip_incoming', function(data) {
    _handleIncoming(data);
  });

  _sio.on('voip_answered', function(data) {
    _handleAnswered(data);
  });

  _sio.on('voip_rejected', function(data) {
    _voipOnCallEnd('rejected');
    toast('📵 Call rejected');
  });

  _sio.on('voip_ended', function(data) {
    _voipOnCallEnd('ended', data.duration);
  });

  _sio.on('voip_ice', function(data) {
    if (_rtc && data.candidate) {
      _rtc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function(e) {
        console.warn('[VoIP] addIceCandidate failed:', e);
      });
    }
  });

  _sio.on('voip_error', function(data) {
    toast('📵 ' + (data.message || 'Call failed'));
    _voipOnCallEnd('failed');
  });
}

/** Disconnect and clean up */
function voipDisconnect() {
  _voipCleanupCall();
  if (_sio) { try { _sio.disconnect(); } catch(e){} _sio = null; }
  _voipSetStatus('● Disconnected', 'var(--text2)');
}

// ============================================================
//  OUTGOING CALL
// ============================================================

/**
 * Call an employee by their badge/username.
 * Called from the contacts list or the chat call-button.
 */
function voipCallEmployee(targetBadge, targetName) {
  if (!_sio || !_sio.connected) {
    toast('VoIP not connected. Connecting…');
    voipInit();
    return;
  }
  if (_activeCallId) {
    toast('Already in a call');
    return;
  }

  var me       = _voipMe();
  var meName   = _voipMeInfo().name;
  var callName = targetName || targetBadge;
  _activePeer  = targetBadge;  // track for ICE routing

  // Navigate to VoIP page
  if (typeof showPage !== 'undefined') showPage('voip');
  _voipShowCalling(callName);

  _getMic().then(function(stream) {
    _localStream = stream;
    _rtc = _newRTC();
    stream.getTracks().forEach(function(t) { _rtc.addTrack(t, stream); });

    return _rtc.createOffer({ offerToReceiveAudio: true });
  }).then(function(offer) {
    return _rtc.setLocalDescription(offer).then(function() { return offer; });
  }).then(function(offer) {
    _sio.emit('voip_call', {
      caller      : me,
      caller_name : meName,
      callee      : targetBadge,
      offer_sdp   : offer.sdp
    });
  }).catch(function(err) {
    toast('📵 Could not start call: ' + err.message);
    _voipOnCallEnd('failed');
  });
}

/** Direct dial from the input box */
function voipDirectCall() {
  var inp  = document.getElementById('voipDirectDial');
  var val  = inp ? inp.value.trim() : '';
  if (!val) { toast('Enter a badge / username'); return; }
  var emp = _findEmpByBadge(val);
  voipCallEmployee(val, emp ? emp.name : val);
  if (inp) inp.value = '';
}

// ============================================================
//  INCOMING CALL
// ============================================================

function _handleIncoming(data) {
  if (_activeCallId) {
    // Already busy — auto-reject
    _sio.emit('voip_reject', { call_id: data.call_id });
    return;
  }

  _activeCallId = data.call_id;
  var callerName = data.caller_name || data.caller;

  // Show overlay
  var av = document.getElementById('voipRingAvatar');
  var nm = document.getElementById('voipRingName');
  var lb = document.getElementById('voipRingLabel');
  if (av) av.textContent = (callerName || '?').charAt(0).toUpperCase();
  if (nm) nm.textContent  = callerName || 'Unknown';
  if (lb) lb.textContent  = data.caller || '';

  var ov = document.getElementById('voipIncomingOverlay');
  if (ov) ov.classList.add('open');
  _voipPlayRingtone();

  // Store offer SDP for when user answers
  _pendingOfferSdp = data.offer_sdp;
  _pendingCallerId = data.caller;
}

var _pendingOfferSdp = null;
var _pendingCallerId = null;

function voipAnswerCall() {
  var ov = document.getElementById('voipIncomingOverlay');
  if (ov) ov.classList.remove('open');
  _voipStopRingtone();

  if (!_activeCallId || !_pendingOfferSdp) { return; }

  var callerName = (document.getElementById('voipRingName') || {}).textContent || _pendingCallerId;
  _activePeer = _pendingCallerId;  // track for ICE routing

  _getMic().then(function(stream) {
    _localStream = stream;
    _rtc = _newRTC();
    stream.getTracks().forEach(function(t) { _rtc.addTrack(t, stream); });

    return _rtc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: _pendingOfferSdp }));
  }).then(function() {
    return _rtc.createAnswer();
  }).then(function(answer) {
    return _rtc.setLocalDescription(answer).then(function() { return answer; });
  }).then(function(answer) {
    _sio.emit('voip_answer', {
      call_id    : _activeCallId,
      answer_sdp : answer.sdp
    });
    _voipShowActive(callerName);
    _voipStartCallTimer(callerName);
    _voipShowHud(callerName);
    if (typeof showPage !== 'undefined') showPage('voip');
  }).catch(function(err) {
    toast('📵 Could not answer call: ' + err.message);
    _voipOnCallEnd('failed');
  });
}

function voipRejectCall() {
  var ov = document.getElementById('voipIncomingOverlay');
  if (ov) ov.classList.remove('open');
  _voipStopRingtone();
  if (_activeCallId && _sio) {
    _sio.emit('voip_reject', { call_id: _activeCallId });
  }
  _voipOnCallEnd('rejected');
}

// ============================================================
//  ANSWERED (callee accepted our outgoing call)
// ============================================================

function _handleAnswered(data) {
  if (!_rtc) return;
  _rtc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.answer_sdp }))
    .then(function() {
      var peerEl  = document.getElementById('voipRingName');
      var peer    = peerEl ? peerEl.textContent : (data.call_id || 'Peer');
      _voipShowActive(peer);
      _voipStartCallTimer(peer);
      _voipShowHud(peer);
    })
    .catch(function(e) { console.warn('[VoIP] setRemoteDescription failed:', e); });
}

// ============================================================
//  CALL CONTROLS
// ============================================================

function voipHangup() {
  if (_activeCallId && _sio) {
    _sio.emit('voip_end', { call_id: _activeCallId, initiator: _voipMe() });
  }
  _voipOnCallEnd('ended');
}

function voipToggleMute() {
  if (!_localStream) return;
  _callMuted = !_callMuted;
  _localStream.getAudioTracks().forEach(function(t) { t.enabled = !_callMuted; });
  var btn  = document.getElementById('voipMuteBtn');
  var btn2 = document.getElementById('voipInPageMuteBtn');
  if (btn)  { btn.textContent  = _callMuted ? '🔇' : '🎙'; btn.classList.toggle('muted', _callMuted); }
  if (btn2) { btn2.textContent = _callMuted ? '🔇 Unmute' : '🎙 Mute'; }
}

// ============================================================
//  RTCPeerConnection helpers
// ============================================================

function _newRTC() {
  var pc = new RTCPeerConnection({ iceServers: VOIP_ICE_SERVERS });

  pc.onicecandidate = function(e) {
    if (!e.candidate || !_activeCallId || !_sio) return;
    _sio.emit('voip_ice', {
      call_id   : _activeCallId,
      target    : _activePeer || '',
      candidate : e.candidate.toJSON()
    });
  };

  pc.ontrack = function(e) {
    if (!_remoteAudio) {
      _remoteAudio = new Audio();
      _remoteAudio.autoplay = true;
      _remoteAudio.setAttribute('playsinline', '');
      _remoteAudio.setAttribute('webkit-playsinline', '');
      document.body.appendChild(_remoteAudio);
      if (typeof _remoteAudio.setSinkId === 'function') {
        _remoteAudio.setSinkId('').catch(function(){});
      }
    }
    _remoteAudio.srcObject = e.streams[0];
    _remoteAudio.play().catch(function(){});
  };

  pc.onconnectionstatechange = function() {
    if (pc.connectionState === 'connected') {
      _callStart = _callStart || Date.now();
    }
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      _voipOnCallEnd('ended');
    }
  };

  return pc;
}

function _getMic() {
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

// ============================================================
//  CALL END / CLEANUP
// ============================================================

function _voipOnCallEnd(reason, durationHint) {
  var duration = durationHint || (_callStart ? Math.floor((Date.now() - _callStart) / 1000) : 0);

  _voipCleanupCall();

  // Refresh history from server
  _voipLoadHistory();

  // Hide overlay & HUD
  var ov = document.getElementById('voipIncomingOverlay');
  if (ov) ov.classList.remove('open');
  _voipHideHud();
  _voipSetActiveBody(null);

  var btn = document.getElementById('voipMuteBtn');
  if (btn) { btn.textContent = '🎙'; btn.classList.remove('muted'); }
}

function _voipCleanupCall() {
  _voipStopRingtone();
  clearInterval(_callTimer);
  _callTimer  = null;
  _callStart  = null;
  _callMuted  = false;
  _activeCallId      = null;
  _activePeer        = null;
  _pendingOfferSdp   = null;
  _pendingCallerId   = null;

  if (_localStream) {
    _localStream.getTracks().forEach(function(t) { t.stop(); });
    _localStream = null;
  }
  if (_rtc) { try { _rtc.close(); } catch(e){} _rtc = null; }
  if (_remoteAudio) {
    _remoteAudio.srcObject = null;
    if (_remoteAudio.parentNode) _remoteAudio.parentNode.removeChild(_remoteAudio);
    _remoteAudio = null;
  }
}

// ============================================================
//  HUD (persistent call bar)
// ============================================================

function _voipShowHud(peer) {
  var hud = document.getElementById('voipHud');
  if (!hud) return;
  var p = document.getElementById('voipHudPeer');
  var s = document.getElementById('voipHudStatus');
  if (p) p.textContent = peer;
  if (s) s.textContent = '● Connected';
  hud.classList.add('active');
}

function _voipHideHud() {
  var hud = document.getElementById('voipHud');
  if (hud) hud.classList.remove('active');
  clearInterval(_callTimer);
  var t = document.getElementById('voipHudTimer');
  if (t) t.textContent = '00:00';
}

function _voipStartCallTimer(peer) {
  _callStart = _callStart || Date.now();
  clearInterval(_callTimer);
  _callTimer = setInterval(function() {
    var s   = Math.floor((Date.now() - _callStart) / 1000);
    var m   = Math.floor(s / 60);
    var sec = s % 60;
    var str = (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
    var t1  = document.getElementById('voipHudTimer');
    var t2  = document.getElementById('voipActiveTimer');
    if (t1) t1.textContent = str;
    if (t2) t2.textContent = str;
  }, 1000);
}

// ============================================================
//  ACTIVE CALL PANEL
// ============================================================

function _voipShowCalling(peer) {
  _voipSetActiveBody(
    '<div class="voip-calling-anim" style="text-align:center;padding:24px">' +
      '<div class="vc-avatar">' + _esc(peer.charAt(0).toUpperCase()) + '</div>' +
      '<div class="vc-name">' + _esc(peer) + '</div>' +
      '<div class="vc-sub">Calling…</div>' +
      '<div class="voip-dots"><div class="voip-dot"></div><div class="voip-dot"></div><div class="voip-dot"></div></div>' +
      '<button class="btn btn-danger btn-sm" onclick="voipHangup()" style="margin-top:20px">📵 Cancel</button>' +
    '</div>'
  );
}

function _voipShowActive(peer) {
  _voipSetActiveBody(
    '<div style="padding:16px;text-align:center">' +
      '<div class="voip-calling-anim">' +
        '<div class="vc-avatar" style="background:linear-gradient(135deg,var(--green),#005522)">' + _esc(peer.charAt(0).toUpperCase()) + '</div>' +
        '<div class="vc-name">' + _esc(peer) + '</div>' +
        '<div class="vc-sub" id="voipActiveTimer" style="font-family:var(--mono)">00:00</div>' +
      '</div>' +
      '<div style="display:flex;gap:12px;justify-content:center;margin-top:16px">' +
        '<button class="btn btn-secondary btn-sm" id="voipInPageMuteBtn" onclick="voipToggleMute()">🎙 Mute</button>' +
        '<button class="btn btn-danger btn-sm" onclick="voipHangup()">📵 Hang Up</button>' +
      '</div>' +
    '</div>'
  );
}

function _voipSetActiveBody(html) {
  var b = document.getElementById('voipActiveBody');
  if (!b) return;
  b.innerHTML = html || '<div class="empty-state" style="padding:24px;text-align:center;color:var(--text2)">No active call</div>';
}

// ============================================================
//  CONTACT DIRECTORY  (online employees from server)
// ============================================================

/* VoIP-local employee list — used when STATE.empList is empty
   (e.g. user lacks view_employees permission) */
var _voipDirCache = [];

function voipLoadContacts() {
  var emps = (STATE && Array.isArray(STATE.empList)) ? STATE.empList : [];
  if (emps.length) {
    // Employees already loaded — build contacts immediately
    _voipBuildContacts();
    _voipRenderContacts();
  } else {
    // Fetch a lightweight directory from the dedicated VoIP endpoint
    // (accessible to all authenticated users, no extra permission needed)
    fetch((typeof CFG !== 'undefined' ? CFG.zkUrl : '') + '/api/voip/directory', {
      credentials: 'include'
    }).then(function(r) { return r.json(); }).then(function(d) {
      _voipDirCache = Array.isArray(d.employees) ? d.employees : [];
      _voipBuildContacts();
      _voipRenderContacts();
    }).catch(function(err) {
      console.warn('[VoIP] directory fetch failed:', err && err.message || err);
      _voipBuildContacts();
      _voipRenderContacts();
    });
  }

  // Also refresh call history
  _voipLoadHistory();
}

function _voipBuildContacts() {
  var me = _voipMe();
  // Prefer the main employee list; fall back to the VoIP-specific directory cache
  var emps = (STATE && Array.isArray(STATE.empList) && STATE.empList.length)
    ? STATE.empList
    : _voipDirCache;
  var onlineMap = {};
  _voipOnline.forEach(function(u) { onlineMap[u.username] = u; });

  // Employees who are online take priority; then all employees
  _voipContacts = emps
    .filter(function(e) { return (e.code || e.badge) && (e.code || e.badge) !== me; })
    .map(function(e) {
      var id     = e.code || e.badge;
      var online = !!onlineMap[id];
      return { id: id, name: e.name || id, dept: e.dept || e.department || '', online: online };
    });

  // Sort: online first, then alphabetical
  _voipContacts.sort(function(a, b) {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });
}

function voipFilterContacts() {
  var q = ((document.getElementById('voipSearchInput') || {}).value || '').toLowerCase();
  var filtered = q
    ? _voipContacts.filter(function(c) {
        return (c.name || '').toLowerCase().includes(q) ||
               (c.dept || '').toLowerCase().includes(q) ||
               (c.id   || '').toLowerCase().includes(q);
      })
    : _voipContacts;
  _renderContactList(filtered);
}

function _voipRenderContacts() {
  _voipBuildContacts();
  var q = ((document.getElementById('voipSearchInput') || {}).value || '').toLowerCase();
  _renderContactList(q
    ? _voipContacts.filter(function(c) {
        return (c.name + c.dept + c.id).toLowerCase().includes(q);
      })
    : _voipContacts
  );
}

function _renderContactList(list) {
  var container = document.getElementById('voipContactList');
  if (!container) return;
  if (!list || !list.length) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);font-size:11px">No contacts found.<br>Employees appear here once online.</div>';
    return;
  }
  // Store for event delegation
  container._clist = list;
  container.innerHTML = list.map(function(c, i) {
    var initials = (c.name || '?').split(' ').filter(Boolean).map(function(w) { return w[0]; }).slice(0,2).join('').toUpperCase();
    var dot      = c.online ? 'background:var(--green)' : 'background:var(--border)';
    return '<div class="voip-user-card" data-vidx="' + i + '">' +
      '<div class="voip-user-av">' + _esc(initials) + '</div>' +
      '<div class="voip-user-info">' +
        '<div class="voip-user-name">' +
          '<span style="width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px;' + dot + '"></span>' +
          _esc(c.name || c.id) +
        '</div>' +
        '<div class="voip-user-dept">' + _esc(c.dept || '') + (c.online ? ' · <span style="color:var(--green)">Online</span>' : '') + '</div>' +
      '</div>' +
      '<button class="voip-call-btn" data-vbtn="' + i + '" title="Call ' + _esc(c.name) + '">📞</button>' +
    '</div>';
  }).join('');

  // Delegated click
  container.onclick = function(e) {
    var btn  = e.target.closest('[data-vbtn]');
    var card = e.target.closest('[data-vidx]');
    var src  = btn || card;
    if (!src) return;
    if (btn) e.stopPropagation();
    var idx  = parseInt(src.getAttribute(btn ? 'data-vbtn' : 'data-vidx'), 10);
    var c    = (container._clist || [])[idx];
    if (c) voipCallEmployee(c.id, c.name);
  };
}

// ============================================================
//  CALL HISTORY  (fetched from server)
// ============================================================

function _voipLoadHistory() {
  if (_voipHistoryHidden) return;
  zkAPI('/api/voip/history?limit=50').then(function(data) {
    _voipRenderHistory(Array.isArray(data.calls) ? data.calls : []);
  }).catch(function() {
    _voipRenderHistory([]);
  });
}

var _voipHistoryHidden = false;

function voipClearHistory() {
  // History lives on the server; this hides it for the current session only.
  // It will reappear on the next page load or refresh.
  _voipHistoryHidden = true;
  _voipRenderHistory([]);
  toast('Call history hidden for this session');
}

function _voipRenderHistory(calls) {
  var container = document.getElementById('voipHistoryList');
  if (!container) return;
  if (!calls || !calls.length) {
    container.innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;color:var(--text2)">No call history</div>';
    container._hist = [];
    return;
  }
  var me = _voipMe();
  container._hist = calls;
  container.innerHTML = calls.map(function(h, idx) {
    var isOut   = h.caller === me;
    var peer    = isOut ? h.callee : h.caller;
    var emp     = _findEmpByBadge(peer);
    var pName   = emp ? emp.name : peer;
    var icon    = isOut ? (h.status === 'completed' ? '📞' : '📵') : (h.status === 'completed' ? '📲' : '📵');
    var dur     = h.duration_s ? _fmtDur(h.duration_s) : '—';
    var ts      = _fmtTime(h.started_at);
    var statusColor = h.status === 'completed' ? 'var(--green)' : h.status === 'ringing' ? 'var(--yellow)' : 'var(--text3)';
    return '<div class="voip-history-row" style="display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid var(--border);font-size:12px">' +
      '<div style="font-size:16px">' + icon + '</div>' +
      '<div style="flex:1">' +
        '<div style="font-weight:600">' + _esc(pName) + '</div>' +
        '<div style="font-size:10px;color:var(--text2)">' + _esc(ts) + '</div>' +
      '</div>' +
      '<span style="font-family:var(--mono);font-size:11px;color:var(--text2)">' + _esc(dur) + '</span>' +
      '<span style="font-size:10px;color:' + statusColor + '">' + _esc(h.status || '') + '</span>' +
      '<button class="voip-call-btn" data-hidx="' + idx + '" title="Call back">📞</button>' +
    '</div>';
  }).join('');

  // Delegated click for call-back buttons
  container.onclick = function(e) {
    var btn = e.target.closest('[data-hidx]');
    if (!btn) return;
    var idx  = parseInt(btn.getAttribute('data-hidx'), 10);
    var h    = (container._hist || [])[idx];
    if (!h) return;
    var peer  = h.caller === _voipMe() ? h.callee : h.caller;
    var emp   = _findEmpByBadge(peer);
    voipCallEmployee(peer, emp ? emp.name : peer);
  };
}

// ============================================================
//  SETTINGS  (no Asterisk — just status + diagnostics)
// ============================================================

function loadVoipSettings() {
  // Nothing to load for the simplified settings — status badge already updates live
}

function saveVoipSettings() {
  // No config needed — just ensure connected
  voipInit();
  toast('VoIP uses the built-in server — no extra config needed');
}

// ============================================================
//  RINGTONE  (AudioContext beep)
// ============================================================

function _voipPlayRingtone() {
  _voipStopRingtone();
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var intervalId = setInterval(function() {
      [480, 440].forEach(function(freq, i) {
        setTimeout(function() {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          gain.gain.value = 0.12;
          osc.start();
          osc.stop(ctx.currentTime + 0.35);
        }, i * 450);
      });
    }, 3000);
    _ringtone = { stop: function() { clearInterval(intervalId); try { ctx.close(); } catch(e) {} } };
  } catch(e) { _ringtone = null; }
}

function _voipStopRingtone() {
  if (_ringtone) { _ringtone.stop(); _ringtone = null; }
}

// ============================================================
//  HELPER: install hint (if flask-socketio missing)
// ============================================================

function _voipShowInstallHint() {
  var container = document.getElementById('voipContactList');
  if (!container) return;
  container.innerHTML =
    '<div style="padding:20px;color:var(--yellow);font-size:12px;line-height:1.8">' +
    '<strong>⚠ VoIP requires flask-socketio</strong><br>' +
    'Run on the server:<br>' +
    '<code style="background:var(--card2);padding:2px 6px;border-radius:3px;font-size:11px">pip install flask-socketio</code><br>' +
    'Then restart the server. No other config needed.' +
    '</div>';
}

// ============================================================
//  STATUS BADGE
// ============================================================

function _voipSetStatus(text, color) {
  ['voipRegStatus', 'voipRegStatus2'].forEach(function(id) {
    var e = document.getElementById(id);
    if (!e) return;
    e.textContent    = text;
    e.style.color    = color || 'var(--text2)';
    e.style.borderColor = color || 'var(--border2)';
  });
  // Keep the header disconnect/reconnect button in sync
  var btn = document.getElementById('voipToggleBtn');
  if (btn) {
    var online = (text || '').indexOf('Online') !== -1;
    btn.textContent  = online ? 'Disconnect' : '🔗 Connect';
    btn.onclick      = online ? voipDisconnect : voipInit;
  }
}

// ============================================================
//  IDENTITY HELPERS
// ============================================================

function _voipMe() {
  return STATE && STATE.user ? (STATE.user.username || STATE.user.badge || '') : '';
}

function _voipMeInfo() {
  if (!STATE || !STATE.user) return { name: '', badge: '', dept: '' };
  var u = STATE.user;
  return {
    name  : u.name  || u.display_name || u.username || '',
    badge : u.badge || u.username     || '',
    dept  : u.dept  || u.department   || ''
  };
}

function _findEmpByBadge(badge) {
  if (!STATE || !Array.isArray(STATE.empList)) return null;
  return STATE.empList.find(function(e) { return (e.code || e.badge) === badge; }) || null;
}

// ============================================================
//  FORMATTING
// ============================================================

function _fmtDur(sec) {
  var m = Math.floor(sec / 60), s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function _fmtTime(iso) {
  try {
    var d = new Date(iso), now = new Date(), diff = (now - d) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return d.toLocaleDateString();
  } catch(e) { return iso || ''; }
}

function _esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// (no _esc2 needed — all dynamic values use data-attributes and event delegation)

// ============================================================
//  CALL BUTTON: Chat integration
//  Called from messages page "📞 Call" button
// ============================================================

function voipCallFromChat() {
  var peer = window.ACTIVE_CHAT_PEER;
  if (!peer) { toast('Select a conversation first'); return; }
  var emp  = _findEmpByBadge(peer);
  voipCallEmployee(peer, emp ? emp.name : peer);
}

// ============================================================
//  AUTO-INIT
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
  setTimeout(voipInit, VOIP_AUTO_CONNECT_DELAY_MS);
});
