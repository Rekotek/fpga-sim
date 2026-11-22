# Texts for the hackathon submission form

The texts are in English, for pasting into the Devpost form. The key is not stored in the
repository: before pasting, replace `<KEY>` with the value from the macOS keychain (service
`fpgasim-judges`, decision 171):

```
security find-generic-password -s fpgasim-judges -w
```

## Testing instructions

Open this link in Chrome, Edge or Firefox on a desktop computer:

https://fpga-sim.scriptorium.cc/?lang=en#key=<KEY>

No sign-in is necessary. The link is for judges only; please do not publish it.

1. On the projects screen, click "From example" and open `blink3`.
2. Click "Run". The project builds on the server in a few seconds, then three LEDs on the board blink
   at 1, 2 and 4 Hz.
3. Click "+ Part" and add an LED on the breadboard on pin 15. It blinks together with LED0.
4. Open the "Waveforms" tab, add signals with "+ Signal", click "Record", then "Stop".
5. Open the "Testbench" tab and click "Run". The output shows `PASS: 8 checks`.
6. Open the example `uart_hello` and click "Run". The terminal shows `Hello, FPGA SIM!`.

Projects made with this link stay in the browser only. All judges share one build limit of
30 builds per minute; if the server reports too many requests, wait one minute.
