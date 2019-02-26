
const chai = require('chai');
const expect = chai.expect;
const WebSocket = require('ws');
const HpServer = require('../');

let hpServer;

describe('hpServer', () => {
  afterEach(function(done) {
    hpServer.close(); 
    done();
  })

  it('should be an instance of websocket server', function(done) {
    hpServer = new HpServer({ port: 8080 });
    expect(Object.prototype.isPrototypeOf(WebSocket.Server.prototype)).to.be.true;  
    done();
  })

  it('should accept any incoming conection of a peer if no verification is needed', function(done) {
    hpServer = new HpServer({ port: 8080 });
    const ws = new WebSocket('ws://localhost:8080/path');
    ws.on('open', function open() {
      done();
    });
    ws.on('error', function (error) {
      done(error);
    });
  })

  it('should not accept an invalid conection of a peer if no verification is not passed ', function (done) {
    const verifyPeer = function (type, peerId, peerKey) {
      if (type === 'myKey') return true;
      else return false;
    }
    hpServer = new HpServer({ port: 8080, verifyPeer: verifyPeer });
    const ws = new WebSocket('ws://localhost:8080/myType/myId/myBadKey');
    ws.on('open', function open() {
      done(new Error('Should not open'));
    });
    ws.on('error', function () {
      done();
    });
  })

  it('should list the peers connected', function (done) {
    hpServer = new HpServer({ port: 8080 });
    const ws1 = new WebSocket('ws://localhost:8080/type1/id1');
    const ws2 = new WebSocket('ws://localhost:8080/type2/id2');
    let count = 0;
    let onOpen = function (wsX) {
      count++;
      if (count === 2) wsX.send(JSON.stringify({ type: 'listPeers' }));
    }
    ws1.on('open', onOpen.bind(null, ws1));
    ws2.on('open', onOpen.bind(null, ws2));
    function onMessage(msg) {
      let message;
      try {
        message = JSON.parse(msg);
      } catch (e) {
        done(e)
        return;
      }
      expect(message.type).to.equal('peers');
      expect(message.peers).to.be.an.instanceof(Array);
      expect(message.peers).to.have.lengthOf(2);
      expect(message.peers[0]).to.have.property('id');
      expect(message.peers[0]).to.have.property('type');
      expect(message.peers[0]).to.have.property('busy');
      expect(message.peers[0].busy).to.be.true;
      expect(message.peers[1].busy).to.be.true;
      done();
    }
    ws1.on('message', onMessage);
    ws2.on('message', onMessage);
    let onError = function(error) {
      done(error);
    }
    ws1.on('error', onError);
    ws2.on('error', onError);
  })

  it('should pair two peers and forward messages between them', function (done) {
    hpServer = new HpServer({ port: 8080 });
    const ws1 = new WebSocket('ws://localhost:8080/type1/id1');
    const ws2 = new WebSocket('ws://localhost:8080/type2/id2');
    let count = 0;
    let onOpen = function () {
      count++;
      if (count === 2) {
        ws2.send(JSON.stringify({ type: 'ready' }));
        ws1.send(JSON.stringify({ type: 'pair', remotePeerId: 'id2' }));
      }
    }
    ws1.on('open', onOpen);
    ws2.on('open', onOpen);
    ws1.on('message', (msg) => {
      let message;
      try {
        message = JSON.parse(msg);
      } catch (e) {
        done(e)
        return;
      }
      if (message.type === 'status') {
        expect(message.status).to.equal('paired');
        ws1.send(JSON.stringify({ type: 'offer', sdp: 'test' }));
      } else if (message.ice) {
        expect(message.ice).to.equal('test');
        done();
      }
    });
    ws2.on('message', (msg) => {
      let message;
      try {
        message = JSON.parse(msg);
      } catch (e) {
        done(e)
        return;
      }
      if(message.type === 'status') {
        expect(message.status).to.equal('paired');
      } else if (message.type === 'offer') {
        expect(message.sdp).to.equal('test');
        ws2.send(JSON.stringify({ ice: 'test' }))
      }
    });
    let onError = function (error) {
      done(error);
    }
    ws1.on('error', onError);
    ws2.on('error', onError);
  })

  it('should unpair two peers, notify them and send an error if they try to exchange messsages afterward', function (done) {
    hpServer = new HpServer({ port: 8080 });
    const ws1 = new WebSocket('ws://localhost:8080/type1/id1');
    const ws2 = new WebSocket('ws://localhost:8080/type2/id2');
    let count = 0;
    let onOpen = function () {
      count++;
      if (count === 2) {
        ws2.send(JSON.stringify({ type: 'ready' }));
        ws1.send(JSON.stringify({ type: 'pair', remotePeerId: 'id2' }));
      }
    }
    ws1.on('open', onOpen);
    ws2.on('open', onOpen);
    let paired1 = false;
    ws1.on('message', (msg) => {
      let message;
      try {
        message = JSON.parse(msg);
      } catch (e) {
        done(e)
        return;
      }
      if (message.type === 'status' && message.status === 'paired') {
        paired1 = true;
        ws1.send(JSON.stringify({ type: 'unpair'}));
      } else if (message.type === 'status' && paired1) {
        expect(message.status).to.equal('unpaired');
      }
    });
    let paired2 = false;
    ws2.on('message', (msg) => {
      let message;
      try {
        message = JSON.parse(msg);
      } catch (e) {
        done(e)
        return;
      }
      if(message.type === 'status' && message.status === 'paired') paired2 = true;
      else if (message.type === 'status' && paired2) {
        expect(message.status).to.equal('unpaired');
        ws2.send(JSON.stringify({ type: 'offer', sdp: 'test' }))
      } else if (message.type === 'error') {
        expect(message.code).to.equal('ERR_BAD_STATE');
        done();
      }
    });
    let onError = function (error) {
      done(error);
    }
    ws1.on('error', onError);
    ws2.on('error', onError);
  })
})