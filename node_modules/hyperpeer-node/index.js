#!/usr/bin / env node

const WebSocket = require('ws');
const url = require("url");
const UrlPattern = require('url-pattern');

class Peer {
  constructor(type, id, ws) {
    this.type = type;
    this.id = id;
    this.ws = ws;
    this.remotePeerId = undefined;
  }

  send(message) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  setRemotePeerId(id) {
    this.remotePeerId = id;
  }
}

class HyperpeerServer extends WebSocket.Server {
  constructor(options) {
    let urlPattern = new UrlPattern('/:peerType(/:peerId)(/:peerKey)');	
    if (typeof options.verifyPeer === 'function') {
      options.verifyClient = function(info) {
        let pathname = url.parse(info.req.url).pathname;
        let peerCredentials;
        try {
          peerCredentials = urlPattern.match(pathname);
        } catch(e) {
          console.log('Invalid peer request!');
          return false;
        }
        let { peerType, peerId, peerKey } = peerCredentials;
        return options.verifyPeer(peerType, peerId, peerKey);
      }
    }
    super(options);
    this.urlPattern = urlPattern;
    this.peers = new Map();
    this.on('connection', this.onPeerConnection);
  }
  
  onPeerConnection(ws, req) {
    let pathname = url.parse(req.url).pathname;
    let peerCredentials;
    try {
      peerCredentials = this.urlPattern.match(pathname);
    } catch (e) {
      return ws.close(3000, 'Invalid peer credentials!');
    }
    let { peerType, peerId, peerKey } = peerCredentials;
    if (!peerId) peerId = 'peer' + Date.now();
    if (this.peers.has(peerId)) {
      return ws.close(3001, 'Peer Id already in use!');
    }
    this.peers.set(peerId, new Peer(peerType, peerId, ws));
    console.log('Peer %s connected', peerId);
    ws.on('message', (msg) => {
      //console.log('Received: %s', msg);
      let message;
      try {
        message = JSON.parse(msg);
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', code: 3002, message: e.toString() }));
        return;
      }
      console.log('Message from peer ' + peerId + '. Type: ' + message.type);
      if (message.type === 'listPeers') {
        ws.send(JSON.stringify({ type: 'peers', peers: this.getPeers() }));
        return;
      }
      if (message.type === 'pair') {
        this.pair(peerId, message.remotePeerId)
      } else if (message.type === 'unpair') {
        this.unpair(peerId);
      } else {
        this.forwardMessage(peerId, message);
      }
    });

    ws.on('close', (code, message) => {
      console.log("Peer " + peerId + " disconnected, code:" + code.toString() + " msg: " + message);
      this.unpair(peerId);
      this.peers.delete(peerId);
    })

  }

  getPeers() {
    let peers = [];
    for (let peer of this.peers.values()) {
      let p = {
        id: peer.id,
        type: peer.type,
        busy: peer.remotePeerId ? true : false
      }
      peers.push(p);
    }
    return peers;
  }

  pair(peerId, remotePeerId) {
    let peer = this.peers.get(peerId);
    if (!this.peers.has(remotePeerId)) {
      peer.send({ type: 'error', code: 3003, message: 'Remote peer does not exists!' });
      return;
    }
    let remotePeer = this.peers.get(remotePeerId);
    if (remotePeer.remotePeerId) {
      peer.send({ type: 'error', code: 3004, message: 'Remote peer is busy!' });
      return;
    }
    if (peer.remotePeerId) {
      this.unpair(peerId);
    }
    peer.remotePeerId = remotePeerId;
    this.peers.set(peerId, peer);
    remotePeer.remotePeerId = peerId;
    this.peers.set(remotePeerId, remotePeer);
    peer.send({ type: 'status', status: 'paired', remotePeerId: remotePeerId });
    remotePeer.send({ type: 'status', status: 'paired', remotePeerId: peerId });
    return;
  }

  unpair(peerId) {
    let peer = this.peers.get(peerId);
    if (peer.remotePeerId) {
      let remotePeer = this.peers.get(peer.remotePeerId);
      if (remotePeer) {
        delete remotePeer.remotePeerId;
        this.peers.set(remotePeer.id, remotePeer);
        remotePeer.send({ type: 'status', status: 'unpaired' });
      }
      delete peer.remotePeerId;
      this.peers.set(peerId, peer);
    }
    peer.send({ type: 'status', status: 'unpaired' });
  }

  forwardMessage(peerId, message) {
    let peer = this.peers.get(peerId);
    if (!peer.remotePeerId) {
      peer.send({ type: 'error', code: 3005, message: 'Cannot forward message to remote peer because peer is not paired!' });
      return;
    }
    let remotePeer = this.peers.get(peer.remotePeerId);
    remotePeer.send(message);
  }
}

module.exports = HyperpeerServer;