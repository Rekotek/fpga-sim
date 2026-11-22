module top (
    input  wire clk,
    output wire led
);
    wire fast;
    rPLL u_pll (.CLKIN(clk), .CLKOUT(fast));
    assign led = fast;
endmodule
