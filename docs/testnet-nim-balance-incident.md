# Testnet NIM Balance Incident

## Summary

NimDares was reporting `insufficient NIM balance. You have 0.00 NIM, need 1` while the Nimiq Pay UI showed more than $100 of value.

The NimDares client was reading the connected address from the TestAlbatross RPC correctly.

The discrepancy was that Nimiq Pay's displayed wallet value is not exposed through the Mini App provider and can include funds locked in HTLC contracts.

NimDares needs a spendable basic-account balance because `sendBasicTransactionWithData` can only spend the connected basic account.

## Verified Address

Address: `NQ96 S669 HERD 4B8N A8MY 47KN PU88 1U3P GSJQ`

Hex address: `d18c98bb2d22d16522bf21e76bf1080f07786a58`

Network: TestAlbatross testnet, network ID `5`

RPC: `https://rpc.testnet.nimiqwatch.com`

## On-Chain Timeline

The official faucet credit of 110,000 NIM arrived in block `11,455,897`.

An earlier 110,000 NIM stake was returned from the previous contract in block `11,456,811`.

Both amounts were then placed into an HTLC in block `11,456,813`, creating a 220,000 NIM locked balance.

NimDares escrow later sent 100,000 NIM to the basic address in transaction `ec743df5cfd0ddf34ffdfc541cb17c23deb5531a10bc394cf0c871fb7e98bc40`, block `11,458,339`.

The HTLC returned 220,000 NIM in block `11,458,391`.

Two blocks later, the full 320,000 NIM was placed into another HTLC in transaction `bbaf3af0b75e491ddc3befdbf0e248a8329ea0ac737278787035ff3bcf72cd51`, block `11,458,393`.

The current basic-account balance was then confirmed as `0` luna at block `11,458,687`.

The latest HTLC contract was `NQ92 3ST5 S5M9 Q95P UB4H 1931 HY9P RG2F 6XUE`, with counterparty `NQ54 FTGY F6VJ EJPU NSMN RA5Q 0K21 8EQT Q05P`.

## Why Pay And NimDares Differ

The Mini App provider exposes `listAccounts()`, signing, block height, basic transfers, and staking methods.

It does not expose a wallet portfolio balance method.

NimDares therefore reads `getAccountByAddress` from the public testnet RPC for the address returned by `listAccounts()`.

That RPC balance is the spendable balance of the basic account.

An HTLC balance is a separate contract account and cannot be spent by NimDares' basic transfer call.

## Reader Behavior

The Stake panel now displays the live RPC account snapshot:

- Network and RPC-backed block height.
- Connected address.
- Account type, such as `basic` or `htlc`.
- Raw balance in luna.
- Spendable balance in NIM.
- Refresh timestamp.

The reader deliberately does not label Pay's aggregate portfolio value as spendable.

## Required Demo State

Before funding a dare, the reader must show:

```text
account type: basic
spendable balance: at least 1 NIM
```

If it shows `htlc` or a zero `basic` balance, the wallet cannot fund the dare through the Mini App provider.
