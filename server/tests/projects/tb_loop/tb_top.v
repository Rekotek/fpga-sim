// Тестбенч без $finish: такт идёт бесконечно.
module tb_top;
    reg clk = 0;
    wire [1:0] led;
    top dut (.clk(clk), .btn(1'b1), .led(led));
    always #1 clk = ~clk;
    initial $display("started");
endmodule
