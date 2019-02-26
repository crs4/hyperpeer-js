
const WebSocket = require('ws');
const url = require("url");
const UrlPattern = require('url-pattern');

/**
 * Represent the peers connected to the server
 * 
 * @private
 * @class Peer
 */
class Peer {
  /**
   * Creates an instance of Peer.
   * @param {string} type
   * @param {string} id
   * @param {Object} ws
   * @param {boolean} busy
   * @memberof Peer
   */
  constructor(type, id, ws) {
    this.type = type;
    this.id = id;
    this.ws = ws;
    this.remotePeerId = undefined;
    this.busy = true;
  }
  /**
   * Send a message to the peer
   *
   * @param {any} message - Message to send
   * @memberof Peer
   */
  send(message) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Set the id of the paired remote peer
   *
   * @param {*} id
   * @memberof Peer
   */
  setRemotePeerId(id) {
    this.remotePeerId = id;
  }
}

/**
 * Creates an instance of HyperpeerServer which is a wrapper of the {@link https://github.com/websockets/ws/blob/HEAD/doc/ws.md|WebSocket.Server} class. HyperpeerServer instances manages the connection of peers, the pairing between peers, and relay messages between paired peers.
 *
 * @class HyperpeerServer
 * @extends {WebSocket.Server}
 * @param {object} options - Websocket server options (see {@link https://github.com/websockets/ws/blob/HEAD/doc/ws.md| ws API})
 * @param {HyperpeerServer~verifyPeer} options.verifyPeer - A function that can be used to validate peers. If set, it replaces verifyClient attribute of WebSocket.Server
 */
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
  
  /**
   * Manages the connection of peers
   *
   * @param {*} ws
   * @param {*} req
   * @memberof HyperpeerServer
   * @private
   */
  onPeerConnection(ws, req) {
    let pathname = url.parse(req.url).pathname;
    let peerCredentials;
    try {
      peerCredentials = this.urlPattern.match(pathname);
    } catch (e) {
      return ws.close('ERR_BAD_REQUEST', 'Invalid peer credentials!');
    }
    let { peerType, peerId, peerKey } = peerCredentials;
    if (!peerId) peerId = 'peer' + Date.now();
    if (this.peers.has(peerId)) {
      return ws.close('ERR_FORBIDDEN', 'Peer Id already in use!');
    }
    this.peers.set(peerId, new Peer(peerType, peerId, ws));
    console.log('Peer %s connected', peerId);
    ws.on('message', (msg) => {
      //console.log('Received: %s', msg);
      let message;
      try {
        message = JSON.parse(msg);
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', code: 'ERR_BAD_SIGNAL', message: e.toString() }));
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
      } else if (message.type === 'ready') {
        this.notBusy(peerId);
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

  /**
   * Returns the list of connected peers
   *
   * @returns {HyperpeerServer~peer[]}
   * @memberof HyperpeerServer
   */
  getPeers() {
    let peers = [];
    for (let peer of this.peers.values()) {
      let p = {
        id: peer.id,
        type: peer.type,
        busy: peer.busy
      }
      peers.push(p);
    }
    return peers;
  }

  /**
   * Pair two peers
   *
   * @param {*} peerId
   * @param {*} remotePeerId
   * @memberof HyperpeerServer
   * @private
   */
  pair(peerId, remotePeerId) {
    let peer = this.peers.get(peerId)
    if (!this.peers.has(remotePeerId)) {
      peer.send({ type: 'error', code: 'ERR_PEER_NOT_FOUND', message: 'Remote peer does not exists!' })
      return
    }
    let remotePeer = this.peers.get(remotePeerId)
    if (remotePeer.busy) {
      peer.send({ type: 'error', code: 'ERR_PEER_BUSY', message: 'Remote peer is busy!' })
      return
    }
    if (peer.remotePeerId) {
      this.unpair(peerId)
    }
    peer.remotePeerId = remotePeerId
    peer.busy = true
    this.peers.set(peerId, peer)
    remotePeer.remotePeerId = peerId
    remotePeer.busy = true
    this.peers.set(remotePeerId, remotePeer);
    peer.send({ type: 'status', status: 'paired', remotePeerId: remotePeerId });
    remotePeer.send({ type: 'status', status: 'paired', remotePeerId: peerId });
    return;
  }

  /**
   * Unpair paired peers
   *
   * @param {*} peerId
   * @memberof HyperpeerServer
   * @private
   */
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

  /**
   * Set a peer as not busy
   *
   * @param {*} peerId
   * @memberof HyperpeerServer
   * @private
   */
  notBusy(peerId) {
    let peer = this.peers.get(peerId)
    peer.busy = false
    this.peers.set(peerId, peer)
  }

  /**
   * Forward messages between paired peers
   *
   * @param {*} peerId
   * @param {*} message
   * @memberof HyperpeerServer
   * @private
   */
  forwardMessage(peerId, message) {
    let peer = this.peers.get(peerId);
    if (!peer.remotePeerId) {
      peer.send({ type: 'error', code: 'ERR_BAD_STATE', message: 'Cannot forward message to remote peer because peer is not paired!' });
      return;
    }
    let remotePeer = this.peers.get(peer.remotePeerId);
    remotePeer.send(message);
  }
}

/**
 * Funcition to verify the connection of a peer
 * @callback HyperpeerServer~verifyPeer
 * @param {string} peerType - Can be used to verify the category of the peer
 * @param {string} peerId - Unique identifier of the peer
 * @param {string} peerKey - Token that can be used to authenticate and authorize the peer
 */
/**
 * Element of the list of peers.
 * @typedef {Object} HyperpeerServer~peer
 * @property {string} id - id of the peer.
 * @property {string} type - type of the peer.
 * @property {boolean} busy - Indicates whether the peer is paired with another peer.
 */
module.exports = HyperpeerServer;