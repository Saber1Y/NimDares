# Testnet NIM Balance and HTLC Incident

## Executive Summary

NimDares is a Nimiq Pay Mini App running against the official TestAlbatross testnet.

The connected Pay address is `NQ96 S669 HERD 4B8N A8MY 47KN PU88 1U3P GSJQ`.

NimDares reports `0.00 NIM` and blocks a 1 NIM stake because the address's spendable basic-account balance is genuinely zero on-chain.

The Nimiq Pay UI shows more than $100 of value, but that value is not currently spendable from the connected basic account.

The funds have repeatedly been moved into native Nimiq HTLC contracts.

The latest observed HTLC contains 320,000 NIM and has the connected address as its sender.

This is a testnet issue, but it prevents the Mini App from completing a real on-chain funding demo.

## Environment

- Network: official Nimiq TestAlbatross testnet.
- Network ID: `5`.
- RPC: `https://rpc.testnet.nimiqwatch.com`.
- Mini App: NimDares.
- Wallet host: Nimiq Pay.
- Connected address: `NQ96 S669 HERD 4B8N A8MY 47KN PU88 1U3P GSJQ`.
- Connected address in hexadecimal: `d18c98bb2d22d16522bf21e76bf1080f07786a58`.
- NimDares testnet escrow: `NQ93 7600 V1VE K63J UQY4 6BS3 4M32 YAM0 GQHD`.

No private keys, seed phrases, or secret environment variables are included in this report.

## User-Visible Symptom

The NimDares create screen shows:

```text
ERR: insufficient NIM balance. You have 0.00 NIM, need 1
```

The Nimiq Pay Mini App HUD shows the expected connected address, `testnet`, and an advancing chain head.

The Nimiq Pay application itself shows more than $100 of wallet value.

The user therefore expected NimDares to be able to stake 1 NIM.

## What NimDares Reads

The Mini App SDK exposes `listAccounts()`, which returns the connected address.

The SDK exposes signing and basic transaction methods, but it does not expose a wallet balance method.

NimDares therefore points the SDK's read-only RPC client at the TestAlbatross RPC and calls `getAccountByAddress` for the address returned by `listAccounts()`.

The NimDares balance reader now displays the exact RPC account snapshot in the Stake panel.

The reader displays the account type, raw luna balance, converted NIM balance, block height, and address.

The reader polls every 10 seconds.

The create preflight check uses the same account read, so the displayed balance and the payment eligibility check cannot disagree.

## Direct RPC Evidence

At block `11,458,687`, the RPC returned the following for the connected address:

```json
{
  "address": "NQ96 S669 HERD 4B8N A8MY 47KN PU88 1U3P GSJQ",
  "balance": 0,
  "type": "basic"
}
```

The balance value is in luna, so `0` luna equals `0 NIM`.

This confirms that the NimDares error is not caused by a mainnet/testnet mismatch, a stale RPC endpoint, or a formatting problem.

The RPC reports the correct TestAlbatross network and the connected address is the address returned by Pay.

## On-Chain Timeline

The address originally received 110,000 NIM from the official faucet in transaction `c2a25627e089cafde7de05bd4ade317634cb602b5cb387ddd374df8377088389` at block `11,455,897`.

An earlier 110,000 NIM stake was returned from the previous contract to the address in transaction `dbca09561674eac71f5006300c1d70ba5f181c684a034c9e2f325e17b859a63b` at block `11,456,811`.

The address then created a 220,000 NIM HTLC in transaction `a76a91dff5124077222f7d98c7e3d6ca2764f55ac07b87a713f7a5e300c0258e` at block `11,456,813`.

The HTLC contract was `NQ35 MCTA UC52 3F0P QP5T 6DR7 19PC LUXP AGGL`.

NimDares sent a 100,000 NIM testnet top-up to the connected address in transaction `ec743df5cfd0ddf34ffdfc541cb17c23deb5531a10bc394cf0c871fb7e98bc40` at block `11,458,339`.

The previous 220,000 NIM HTLC returned its funds to the basic address in transaction `3728a19cb594c90c9afc88635c30a506fabf8b59b78cf5f7b41bdaf67aeed0aa` at block `11,458,391`.

Two blocks later, the connected address placed the combined 320,000 NIM into a new HTLC in transaction `bbaf3af0b75e491ddc3befdbf0e248a8329ea0ac737278787035ff3bcf72cd51` at block `11,458,393`.

The latest HTLC is `NQ92 3ST5 S5M9 Q95P UB4H 1931 HY9P RG2F 6XUE`.

The latest HTLC reports a balance of 320,000 NIM, sender `NQ96 S669 HERD 4B8N A8MY 47KN PU88 1U3P GSJQ`, and recipient `NQ54 FTGY F6VJ EJPU NSMN RA5Q 0K21 8EQT Q05P`.

The latest observed timeout is September 28, 2026.

The transaction history shows that the basic account did receive funds, but those funds were subsequently moved into HTLC contracts.

## Technical Diagnosis

Nimiq has separate account types, including basic accounts and HTLC contracts.

A basic account balance is spendable through a normal `sendBasicTransactionWithData` call.

An HTLC balance is locked by contract conditions and cannot be spent through a normal basic transfer.

The Mini App provider does not expose HTLC creation, settlement, early resolve, or timeout refund methods in the currently used SDK.

NimDares cannot unlock the user's HTLC because NimDares does not control the user's private key, does not know the swap preimage, and does not possess the counterparty signature.

The observed recipient address and native HTLC pattern are consistent with Nimiq Pay's Fastspot-style atomic swap infrastructure.

This attribution should be confirmed by the Nimiq Pay or Fastspot team through their internal swap/activity records.

NimDares itself does not create HTLCs.

NimDares only sends a basic NIM transaction to its configured escrow address with a `nimdares:` memo.

None of the observed HTLC transactions target the NimDares escrow address or contain a NimDares funding memo.

## Fresh-Account Reproduction

To rule out the possibility that the original address was permanently contaminated by an old swap, a new Pay testnet address was used:

`NQ60 KHR2 9DX2 VAYP F02Q ABLA 9STG XFTD MKQT`

The faucet successfully credited this new address with 110,000 NIM in transaction `02a26d4f8c34c48027aa11ba42d2864dd6fe0c1d7b5eb1d8577f78667e76994a` at block `11,459,820`.

Two blocks later, the new address created an HTLC containing the entire 110,000 NIM in transaction `5c9240361288c7d355cfa369c8c427d0a371a0f5907eaabb73285cc195dc35a3` at block `11,459,822`.

The new HTLC is `NQ98 UQHQ PXM7 31LP NKQ0 R8FU BQBN BSUC CLAQ`.

The HTLC reports sender `NQ60 KHR2 9DX2 VAYP F02Q ABLA 9STG XFTD MKQT`, recipient `NQ54 FTGY F6VJ EJPU NSMN RA5Q 0K21 8EQT Q05P`, balance `110,000 NIM`, and account type `htlc`.

The fresh basic address subsequently reported balance `0`.

This reproduction proves the behavior is not caused by the original address's prior HTLC history and is not caused by NimDares.

It occurs on a newly funded Pay testnet address before NimDares can spend the received NIM.

The common recipient `NQ54 FTGY F6VJ EJPU NSMN RA5Q 0K21 8EQT Q05P` strongly indicates a Pay/Fastspot-side automated swap or settlement flow.

The exact Pay UI action or background trigger still needs confirmation from the Pay/Fastspot team.

## Why the Pay Display Differs

The Pay UI appears to show an aggregate wallet or portfolio value.

That value can include funds held in contracts or swap flows.

The Mini App receives only the connected address and transaction/signing capabilities.

It does not receive the same aggregate balance calculation that the Pay application displays.

For NimDares, the relevant value is the spendable basic-account balance because the stake transaction is a normal basic transfer.

## Recovery Paths

An HTLC can generally be resolved in one of three ways.

1. The recipient claims it by presenting the correct preimage.
2. The sender and recipient perform an early resolve with both signatures.
3. After the timeout, the sender performs a timeout resolve and reclaims the remaining funds.

For the current HTLC, the sender is the user's address, but the current Mini App SDK does not expose the required HTLC refund transaction method.

The Nimiq Pay or Fastspot swap flow should either complete the swap, cancel/refund it, or provide a supported recovery path.

If the swap flow cannot be recovered before the timeout, a compatible Nimiq wallet or testnet tool must submit the sender's timeout resolve after September 28, 2026.

## Requested Help From The Team

Please identify the swap or payment flow associated with counterparty address `NQ54 FTGY F6VJ EJPU NSMN RA5Q 0K21 8EQT Q05P`.

Please confirm why funds sent to the Pay-connected basic address are being moved into new HTLCs without an obvious visible swap/refund action in the Pay UI.

Please provide the supported testnet recovery procedure for HTLC `NQ92 3ST5 S5M9 Q95P UB4H 1931 HY9P RG2F 6XUE`.

Please confirm whether the Pay UI's displayed balance intentionally includes HTLC-held funds while the Mini App's connected basic account reports zero.

Please provide a supported way for a Mini App to distinguish spendable basic balance from locked contract value.

Please confirm whether the testnet Pay account can be reset or whether a fresh testnet account must be created for Mini App testing.

## Current NimDares Status

NimDares now has a live Testnet NIM account reader in the Stake section.

The reader is deployed locally at `http://192.168.1.114:3110`.

The change is committed as `82ae02f`.

Typecheck and production build both pass.

The reader currently reports the chain truth: account type `basic`, balance `0 NIM`, and the connected Pay address.

NimDares is ready to continue immediately once the connected basic account contains at least 1 NIM.
