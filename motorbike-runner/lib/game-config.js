/* The ONLY file that differs between demo and production.
 * IT: set transport to 'server' and serverUrl to the deployed classroom server. */
export default Object.freeze({
  gameId: 'motorbike-runner',          // lowercase-dash, e.g. 'meo-leo-cau' — also the server's content key
  gameVersion: '1.0.0',
  pace: 'self',                   // 'self' = each student moves on their own | 'teacher' = teacher presses Next
  maxPlayers: 4,

  transport: 'local',             // 'local' = same-browser demo | 'server' = real online class
  serverUrl: '',                  // e.g. 'wss://classroom.edupia.vn/ws' (required when transport = 'server')

  // Local demo only. In server mode the server reads the source configured by the content owner.
  localContent: {
    url: 'content.json',          // same-origin file, or an https URL whose host is listed below
    allowedHosts: []              // e.g. ['static-mass.edupia.vn']; never add docs.google.com here (needs the server)
  }
});
