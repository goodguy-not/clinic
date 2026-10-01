# Staging on your computer — notes for the owner

Milestone 10, checkpoint A7. A complete copy of the clinic system runs on this
Windows computer, inside its own small Linux "server" (a WSL distribution called
`clinic-staging`). It was installed exactly as the real server will be
(`docs/DEPLOYMENT_RUNBOOK.md`). Everything in it is invented: the families, the
money, the therapists and every piece of website text, which is marked
«نمونه». Nothing in it is real and nothing leaves this computer.

Your existing Linux (`Ubuntu`) is separate and was not touched.

## Starting and stopping

Staging switches itself off about a minute after nothing is using it. To keep it
running while you look around, open **PowerShell** and run:

```powershell
Start-Process wsl.exe -ArgumentList '-d','clinic-staging','--exec','sleep','infinity' -WindowStyle Hidden
```

Give it about twenty seconds the first time. To switch it off:

```powershell
wsl --terminate clinic-staging
```

Switching it off loses nothing: everything is kept until you remove it.

## The addresses

| What               | Address                   |
| ------------------ | ------------------------- |
| The public website | `https://localhost/`      |
| Staff sign-in      | `https://localhost/login` |

The browser will say the connection is **not private**. That is expected: the
certificate was made on this computer for staging, not issued by a public
authority (the real server gets a real one). Choose **Advanced**, then
**Continue to localhost**. Do not do this for any other site.

The usernames and passwords for your tour are in the checkpoint report, not in
any file. Each asks you to choose a new password the first time you sign in.
They work only here.

## What to look at

- Signed in as the **manager**: the dashboard (with the backup and nightly-job
  status), families and their balances, the diary, reports, therapist
  settlement, the website content and photographs, staff accounts.
- Signed in as the **receptionist**: the same clinic, with only what a
  receptionist may do. Try something only a manager may do, and see it refused.
- The **public website**: every page, on a narrow window too.

The practice clinic holds two months of invented activity whose books balance
to the last toman. Change anything you like: it is all disposable.

## On your phone (optional, home Wi-Fi only)

Staging is ready to answer at this computer's Wi-Fi address,
`https://192.168.2.46`, but Windows does not let anything in until you allow it.
That is a change to Windows' own security settings, so you make it yourself, and
you undo it when the tour is over. Nothing is opened to the internet: no change
to your router, and the rule admits only devices on the same Wi-Fi.

1. Check the address is still `192.168.2.46` (it can change when the router
   restarts): `Get-NetIPAddress -InterfaceAlias Wi-Fi -AddressFamily IPv4`. If it
   changed, ask for staging to be updated to the new one first.
2. Open **PowerShell as Administrator** and run both lines:

   ```powershell
   netsh interface portproxy add v4tov4 listenaddress=192.168.2.46 listenport=443 connectaddress=127.0.0.1 connectport=443
   ```

   ```powershell
   New-NetFirewallRule -DisplayName 'clinic-staging phone (temporary)' -Direction Inbound -Protocol TCP -LocalAddress 192.168.2.46 -LocalPort 443 -RemoteAddress LocalSubnet -Action Allow
   ```

3. Start staging (above), then on the phone, on the same Wi-Fi, open
   `https://192.168.2.46/`. The phone warns about the certificate, as the
   computer does; continue.

**When you have finished — and before taking the computer to any other network**
— remove both, again as Administrator:

```powershell
netsh interface portproxy delete v4tov4 listenaddress=192.168.2.46 listenport=443
```

```powershell
Remove-NetFirewallRule -DisplayName 'clinic-staging phone (temporary)'
```

These two steps were prepared but not tried: making them is yours.

## Removing everything

When you have finished, one command removes staging completely — its disk, the
practice clinic, every account and every key in it:

```powershell
wsl --unregister clinic-staging
```

That cannot be undone, and nothing else on the computer is affected. Then
delete the empty folder `E:\wsl` if it is still there.

If the backup collector was installed on this computer for the rehearsal, remove
it as well — see the checkpoint report for the exact steps.
