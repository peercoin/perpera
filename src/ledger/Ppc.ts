import { Transport } from "@ledgerhq/hw-transport";

import { getWalletPublicKey } from "./getWalletPublicKey";
import { AddressFormat } from "./getWalletPublicKey";

export default class Ppc{
    private transport: Transport<any>;
    
    constructor(transport: Transport<any>, scrambleKey: string = "PPC") {
        this.transport = transport;
        transport.decorateAppAPIMethods(
            this,
            [
				"getWalletPublicKey"
            ],
            scrambleKey
        );
    }

    public async getWalletPublicKey(
        path: string,
        opts?: boolean | { verify?: boolean, format?: AddressFormat }
    ): Promise<{
        publicKey: string,
        peercoinAddress: string,
        chainCode: string
    }> {
        let options;
        if (arguments.length > 2 || typeof opts === "boolean") {
          console.warn(
            "btc.getWalletPublicKey deprecated signature used. Please switch to getWalletPublicKey(path, { format, verify })"
          );
          options = {
            verify: !!opts,
            format: arguments[2] ? "p2sh" : "legacy"
          };
        } else {
          options = opts || {};
        }
        return await getWalletPublicKey(this.transport, { ...options, path });
    }
}