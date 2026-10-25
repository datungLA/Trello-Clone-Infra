#!/bin/sh
set -eu
test "${TRELLO_VERIFY_ENV:-}" = dev || { printf '%s\n' 'Run only on Dev.' >&2; exit 1; }
infra=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
work=$(mktemp -d /tmp/trello-edge.XXXXXXXX)
suffix=$(basename "$work" | tr '[:upper:].' '[:lower:]_')
network=${DEV_NETWORK:-trello-dev_default}
probe="$suffix-probe"
gateway="$suffix-gateway"
cleanup() { docker rm -f "$gateway" "$probe" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$work/privkey.pem" -out "$work/fullchain.pem" -days 1 -subj /CN=trello-app.learnvibecode.online >/dev/null 2>&1
sed "s/api:3000/$probe:3000/g" "$infra/nginx/production.conf" > "$work/production.conf"
docker run -d --name "$probe" --network "$network" --memory 64m node:24-alpine node -e 'require("http").createServer((req,res)=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify(req.headers));}).listen(3000,"0.0.0.0")' >/dev/null
docker run -d --name "$gateway" --network "$network" --memory 32m -v "$work/production.conf:/etc/nginx/conf.d/default.conf:ro" -v "$infra/nginx/cloudflare-realip.conf:/etc/nginx/cloudflare-realip.conf:ro" -v "$work:/etc/nginx/tls:ro" nginx:1.28-alpine >/dev/null
docker exec "$gateway" nginx -t
docker exec -i -e GATEWAY="$gateway" "$probe" node <<'JS'
const https = require('https'), assert = require('assert/strict');
const gateway = process.env.GATEWAY;
async function request(path, host = 'trello-app.learnvibecode.online', extra = {}) {
  return new Promise((resolve,reject) => {
    const req = https.get({ hostname: gateway, port:443, path, servername:host, rejectUnauthorized:false, headers:{Host:host,...extra} },res=>{
      let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
    });req.on('error',reject);
  });
}
(async()=>{
  let response;
  for(let i=0;i<30;i++){try{response=await request('/api/probe');break;}catch{await new Promise(r=>setTimeout(r,200));}}
  assert.equal(response?.status,200);
  response=await request('/api/probe','trello-app.learnvibecode.online',{'X-Forwarded-For':'203.0.113.42','CF-Connecting-IP':'203.0.113.43'});
  const headers=JSON.parse(response.body);
  assert.notEqual(headers['x-forwarded-for'],'203.0.113.42');
  assert.notEqual(headers['x-forwarded-for'],'203.0.113.43');
  assert.equal(headers['x-forwarded-proto'],'https');
  assert.match(response.headers['strict-transport-security'],/max-age=/);
  response=await request('/','trello-admin.learnvibecode.online');
  assert.equal(response.status,302);assert.equal(new URL(response.headers.location,'https://trello-admin.learnvibecode.online').pathname,'/admin');
  console.log('PASS: isolated TLS gateway, secure forwarding, spoof rejection, HSTS and admin routing.');
})().catch(error=>{console.error(error);process.exit(1)});
JS
