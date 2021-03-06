"use strict";

var optional = require("optional");
var ursa = optional('ursa');
var fs = require('fs');
var path = require('path');
var ejs = require('ejs');
var SignedXml = require('xml-crypto').SignedXml;
var uuid = require('node-uuid');
var wsseSecurityHeaderTemplate = ejs.compile(fs.readFileSync(path.join(__dirname, 'templates', 'wsse-security-header.ejs')).toString());
var wsseSecurityTokenTemplate = ejs.compile(fs.readFileSync(path.join(__dirname, 'templates', 'wsse-security-token.ejs')).toString());

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function dateStringForSOAP(date) {
  return date.getUTCFullYear() + '-' + ('0' + (date.getUTCMonth() + 1)).slice(-2) + '-' +
    ('0' + date.getUTCDate()).slice(-2) + 'T' + ('0' + date.getUTCHours()).slice(-2) + ":" +
    ('0' + date.getUTCMinutes()).slice(-2) + ":" + ('0' + date.getUTCSeconds()).slice(-2) + "Z";
}

function generateCreated() {
  return dateStringForSOAP(new Date());
}

function generateExpires() {
  return dateStringForSOAP(addMinutes(new Date(), 10));
}

function insertStr(src, dst, pos) {
  return [dst.slice(0, pos), src, dst.slice(pos)].join('');
}

function generateId() {
  return uuid.v4().replace(/-/gm, '');
}

function WSSecurityCert(privatePEM, publicP12PEM, password, encoding) {
  if (!ursa) {
    throw new Error('Module ursa must be installed to use WSSecurityCert');
  }
  this.privateKey = ursa.createPrivateKey(privatePEM, password, encoding);
  this.publicP12PEM = publicP12PEM.toString().replace('-----BEGIN CERTIFICATE-----', '').replace('-----END CERTIFICATE-----', '').replace(/(\r\n|\n|\r)/gm, '');

  this.signer = new SignedXml();
  this.signer.signingKey = this.privateKey.toPrivatePem();
  this.x509Id = "x509-" + generateId();

  var references = ["http://www.w3.org/2000/09/xmldsig#enveloped-signature",
    "http://www.w3.org/2001/10/xml-exc-c14n#"];

  this.signer.addReference("//*[local-name(.)='Body']", references);
  this.signer.addReference("//*[local-name(.)='Timestamp' and not(ancestor::*[local-name(.)='Body'])]", references);

  var _this = this;
  this.signer.keyInfoProvider = {};
  this.signer.keyInfoProvider.getKeyInfo = function (key) {
    return wsseSecurityTokenTemplate({ x509Id: _this.x509Id });
  };
}

WSSecurityCert.prototype.postProcess = function (xml) {
  this.created = generateCreated();
  this.expires = generateExpires();

  var secHeader = wsseSecurityHeaderTemplate({
    binaryToken: this.publicP12PEM,
    created: this.created,
    expires: this.expires,
    id: this.x509Id
  });

  var xmlWithSec = insertStr(secHeader, xml, xml.indexOf('</soap:Header>'));

  this.signer.computeSignature(xmlWithSec);

  return insertStr(this.signer.getSignatureXml(), xmlWithSec, xmlWithSec.indexOf('</wsse:Security>'));
};

module.exports = WSSecurityCert;
