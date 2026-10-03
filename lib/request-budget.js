"use strict";
// Verified membership receives its own budget; guessed IDs get no exemption.
function nativeRequestMember(req, pathname, searchParams, rooms, equal) {
  if (req.method !== 'GET' && req.method !== 'POST') return null;
  const route = /^\/api\/rooms\/([a-z0-9]+)\/(?:poll|event|leave|moments|voice\/(?:open|push|pull|close))$/.exec(pathname);
  if (!route) return null;
  const room = rooms.get(route[1]);
  const clientId = req.headers['x-client-id'] || searchParams.get('clientId');
  const grant = req.headers['x-session-grant'];
  if (!room || typeof clientId !== 'string' || typeof grant !== 'string') return null;
  const member = room.members.get(clientId);
  return member && equal(grant, member.grant) ? member : null;
}
function applyRequestBudget(req, url, rooms, equal, rate, address) {
  // Still bound the total load of a shared gateway, even for valid members.
  rate('edge:' + address, 12000, 60000);
  const member = nativeRequestMember(req, url.pathname, url.searchParams, rooms, equal);
  if (member) rate('member-http:' + member.id, 900, 60000);
  else rate('http:' + address, 1200, 60000);
}
module.exports = {nativeRequestMember, applyRequestBudget};
