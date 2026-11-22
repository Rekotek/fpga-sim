// Ожидаемое поведение: led[0] мигает с частотой 1 Гц, led[1] — 2 Гц,
// led[2] — 4 Гц, led[3..5] погашены. Светодиоды горят при нуле.
module top (
    input  wire       clk,
    output wire [5:0] led
);
    localparam integer CLK_HZ = 27_000_000;

    reg [24:0] cnt_a = 0, cnt_b = 0, cnt_c = 0;
    reg [2:0]  q = 0;

    always @(posedge clk) begin
        if (cnt_a == CLK_HZ / 2 - 1) begin cnt_a <= 0; q[0] <= ~q[0]; end
        else cnt_a <= cnt_a + 1'b1;
        if (cnt_b == CLK_HZ / 4 - 1) begin cnt_b <= 0; q[1] <= ~q[1]; end
        else cnt_b <= cnt_b + 1'b1;
        if (cnt_c == CLK_HZ / 8 - 1) begin cnt_c <= 0; q[2] <= ~q[2]; end
        else cnt_c <= cnt_c + 1'b1;
    end

    assign led = {3'b111, ~q};
endmodule
