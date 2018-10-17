# perpera

## usage

The browser bundle is built by running `npm run bundle`. The resulting `dist/bundle.js` file should be referenced using
a `<script>` tag, which exposes the library interface through a global `perpera` object.

Available networks are accessible through the `perpera.networks` object: the keys are names and the values are instances
of the `perpera.Network` class.

The central concept is the document.

    var tag = 'foo'; // unique identifier of the document
    var net = perpera.networks['peercoin']; // the blockchain used to store the document's history
    var doc = new perpera.Document(tag, net);
    doc.sync().then(function() {
      // the document is now loaded from the underlying blockchain
    });

After the promise returned by the `sync()` method is fulfilled, the document's `transitions` property may be inspected.
It is an array of transitions, which make up the document's history. Refer to the `src/model.ts` file to understand the
structure of these objects.

In order to modify a document, specially crafted transactions are inserted into the blockchain. Funds spent on these
transactions are handled using instances of `perpera.Spender`.

    var wif = '...'; // private key in WIF (wallet interchange format)
    var spender = perpera.Spender.fromWIF(wif, 'peercoin'); // or perpera.Network instance
    spender.sync().then(function() {
      // the UTXOs are now loaded into the spender instance
    });

The document's content is updated by providing a collection of hash digests:

    var hash = {
      'sha2-256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    };
    doc.updateContent(hash, spender).then(function() {
      // the transactions have been sent to the network
    });

This should only be performed after both the document and the spender have been synced. If the spender is not the
current owner of the document, an error is thrown without broadcasting any transactions.

It is possible to attach URIs to a document:

    doc.addUri('https://example.com/foo.txt', spender).then(function() {
      // the transactions have been sent to the network
    });

If the given URI is too long to fit into a transaction, an error is thrown.

