// Проект для тестов сервера: счётчик на светодиодах.
module top (
    input  wire       clk,
    input  wire       btn,
    output wire [1:0] led
);
    reg [1:0] cnt = 0;
    always @(posedge clk) if (btn) cnt <= cnt + 1'b1;
    assign led = cnt;
endmodule

module tb_top;
    reg clk = 0;
    wire [1:0] led;
    top dut (.clk(clk), .btn(1'b1), .led(led));
endmodule
