/**
 * Class to get twitter public stream.
 *
 * Based upon code from:
 * https://github.com/nodejstr/twitter-public-stream
 *
 * Changed data parse method, hopefully resulting in less garbage.
 */

'use strict';

// region Imports

const oauth = require('oauth');
const events = require('events');
const _ = require('underscore');
const util = require('util');

// endregion

// region Constants

const PUBLIC_STREAM_URL = 'https://stream.twitter.com/1.1/statuses/filter.json';
const REQUEST_TOKEN_URL = 'https://api.twitter.com/oauth/request_token';
const ACCESS_TOKEN_URL = 'https://api.twitter.com/oauth/access_token';

// endregion

// region Exports

module.exports = Stream;

// endregion

// region Type definitions

/**
 * Parameters
 * @typedef {object} StreamParameters
 * @property {string} consumer_key
 *   Twitter consumer key
 * @property {string} consumer_secret
 *   Twitter consumer secret
 * @property {string} access_token_key
 *   Twitter access token
 * @property {string} access_token_secret
 *   Twitter access token secret
 * @property {string} track
 *   Tracking data (tweet filter)
 */

// endregion

// region Stream class

/**
 * Constructor function
 *
 * @param {StreamParameters} aParams
 *   Parameters to use
 * @returns {Stream} instance
 * @constructor
 */
function Stream(aParams) {

  if (!(this instanceof Stream)) {
    return new Stream(aParams);
  }
  events.EventEmitter.call(this);
  /**
   * @type {StreamParameters}
   */
  this.m_params = aParams;
  
  /**
   * @type {OAuth}
   */
  this.m_oauth = new oauth.OAuth(
    REQUEST_TOKEN_URL,
    ACCESS_TOKEN_URL,
    this.m_params.consumer_key,
    this.m_params.consumer_secret,
    '1.0',
    null,
    'HMAC-SHA1',
    null,
    {
      'Accept': '*/*',
      'Connection': 'close',
      'User-Agent': 'public-stream.js'
    }
  );

  /**
   * @type {Request|null}
   */
  this.m_request = null;
}

// Stream is subclass of EventEmitter
util.inherits(Stream, events.EventEmitter);

/**
 * Changes the initial parameters used with the constructor. The parameters
 * will be used when starting a new stream with {@link stream}.
 *
 * Changes to {@link StreamParameters#consumer_key} and
 * {@link StreamParameters#consumer_secret} are ignored.
 *
 * This method should be called before {@link stream}. Calling this method
 * while a stream is active will not change the current stream.
 *
 * @param {StreamParameters} aParams
 *   New parameters to use
 */
Stream.prototype.changeParams = function(aParams) {
  this.m_params = _.extend(this.m_params, aParams);
};

/**
 * Closes and destroys the current stream.
 */
Stream.prototype.destroy = function() {
  if (this.m_request !== null) {
    this.m_request.abort();
    this.m_request = null;
  }
};

/**
 * Starts the stream.
 */
Stream.prototype.stream = function () {
  // shortcut to instance
  const self = this;
  // start a request
  this.m_request = this.m_oauth.post(
    PUBLIC_STREAM_URL,
    this.m_params.access_token_key,
    this.m_params.access_token_secret,
    {
      delimited: 'length',
      stall_warnings: 'true',
      track: this.m_params.track
    },
    null
  );
  // handle request response
  this.m_request.on('response', function (response) {
    if (response.statusCode > 200) {
      self.emit('error', {
        type: 'response',
        data: {
          code: response.statusCode
        }
      });
      self.m_request = null;
    }
    else {
      // buffer contains data received
      let buffer = '';
      // every status is split by linefeed
      const lineEnd = '\r\n';
      // data length received
      let dataLength = 0;
      // busy getting data length (true) or data (false)
      let getLength = true;
      // emit connected event
      self.emit('connected');
      // set chunk encoding
      response.setEncoding('utf8');
      // process incoming chunks
      response.on('data', function (chunk) {
        // is heartbeat?
        if (chunk == lineEnd) {
          self.emit('heartbeat');
          return;
        }
        // add chunk to buffer
        buffer += chunk;
        // process buffer until no more line ends are found
        while (true) {
          // get position of line end, exit if none is found
          const lineEndPos = buffer.indexOf(lineEnd);
          if (lineEndPos < 0) {
            break;
          }
          // get text till line end
          const textLine = buffer.slice(0, lineEndPos);
          // and remove from buffer (including the line end)
          buffer = buffer.slice(lineEndPos + lineEnd.length);
          // either line text is the length of the data or the data itself
          if (getLength) {
            dataLength = parseInt(textLine);
          }
          else {
            // validate length and give feedback if there is a mismatch
            if (dataLength !== textLine.length + lineEnd.length) {
              console.log(
                'data has different length',
                dataLength,
                textLine.length + lineEnd.length
              );
            }
            // by default data is not parsed correctly
            let parsed = false;
            let data = null;
            try {
              data = JSON.parse(textLine);
              parsed = true;
            }
            catch (error) {
              console.log('garbage', textLine);
              self.emit('garbage', textLine);
            }
            if (parsed) {
              self.emit('data', data);
            }
          }
          // toggle between getting length and getting data
          getLength = !getLength;
        }
      });
      // process error while waiting for chunks
      response.on('error', function (error) {
        self.emit('close', error);
        self.m_request = null;
      });
      // handle server notifying end
      response.on('end', function () {
        self.emit('close', 'socket end');
        self.m_request = null;
      });
      // handle closing of the connection
      response.on('close', function () {
        self.m_request.abort();
        self.m_request = null;
      });
    }
  });
  // handle request error
  this.m_request.on('error', function (error) {
    self.emit('error', {
      type: 'request',
      data: error
    });
    self.m_request = null;
  });
  // process the request
  this.m_request.end();
};

// endregion
