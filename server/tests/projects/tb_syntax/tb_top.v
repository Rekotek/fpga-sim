// Тестбенч с ошибкой: в строке 6 нет точки с запятой.
module tb_top;
    reg clk = 0;
    wire [1:0] led;
    top dut (.clk(clk), .btn(1'b1), .led(led));
    initial #100 $finish
endmodule
