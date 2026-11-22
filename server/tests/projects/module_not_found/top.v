module top (
    input  wire clk,
    output wire led
);
    blinker u_blink (.clk(clk), .led(led));
endmodule
