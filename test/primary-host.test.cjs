const test=require('node:test'),assert=require('node:assert/strict');
const {connectionRecord,partitionFor,locatePrimary}=require('../src/primary-host.cjs');
const id='d7b1f040-8938-4840-9606-f1d35aba1cb8',other='e7b1f040-8938-4840-9606-f1d35aba1cb8';
const candidate={id,name:'Media PC',host:'192.168.1.25',port:43879};
test('saved primary records contain no SSH secrets and session partitions follow identity not a tunnel port',()=>{
 const record=connectionRecord(candidate,{kind:'ssh',host:'media.example',username:'user',password:'never-save-in-catalog',passphrase:'also-secret',keyPath:'/keys/media'});
 assert.doesNotMatch(JSON.stringify(record),/password|passphrase|secret/);
 assert.equal(record.keyPath,'/keys/media');assert.equal(record.kind,'ssh');
 assert.match(partitionFor(id),/^persist:/);assert.notEqual(partitionFor(id),partitionFor(other));
 assert.throws(()=>connectionRecord({...candidate,id:null},{kind:'lan'}),/Update/);
 assert.throws(()=>connectionRecord({...candidate,host:'8.8.8.8'},{kind:'lan'}),/private/);
});
test('LAN startup reconnects directly or follows the same host after DHCP, never a same-name replacement',async()=>{
 const record=connectionRecord(candidate,{kind:'lan'});let scans=0;
 assert.equal((await locatePrimary(record,{probe:async()=>candidate,discover:async()=>{scans++;return[]}})).candidate.host,candidate.host);assert.equal(scans,0);
 const moved={...candidate,host:'192.168.1.44'};
 assert.equal((await locatePrimary(record,{probe:async()=>({...candidate,id:other}),discover:async()=>[moved]})).candidate.host,moved.host);
 await assert.rejects(locatePrimary(record,{probe:async()=>({...candidate,id:other}),discover:async()=>[{...moved,id:other}]}),/unavailable/);
 await assert.rejects(locatePrimary({...record,host:'8.8.8.8'},{probe:()=>assert.fail('public address probed')}),/Invalid/);
});
test('SSH reconnect uses stored fingerprint and credentials, validates target identity and closes failed tunnels',async()=>{
 const record=connectionRecord(candidate,{kind:'ssh',host:'media.example',username:'user',keyPath:'/keys/media'});
 const knownKeys={'media.example:22':'SHA256:trusted'};let closed=0;
 const tunnel={port:45678,close:()=>closed++};
 const deps={knownKeys,credentials:async()=>({password:'encrypted-at-rest'}),ssh:async(input,expected)=>{assert.equal(expected,'SHA256:trusted');assert.equal(input.password,'encrypted-at-rest');return tunnel;},probe:async(host,options)=>{assert.equal(host,'127.0.0.1');assert.equal(options.port,tunnel.port);return candidate;}};
 assert.equal((await locatePrimary(record,deps)).tunnel,tunnel);assert.equal(closed,0);
 await assert.rejects(locatePrimary(record,{...deps,probe:async()=>({...candidate,id:other})}),/not your saved/);assert.equal(closed,1);
 await assert.rejects(locatePrimary(record,{...deps,knownKeys:{}}),/fingerprint/);
});
