// Опыт для варианта «счётчик стабильности»: 10 коротких помех по 300 нс (~8 тактов,
// меньше периода опроса) при отпущенной кнопке. Нажатий не было — счёт должен остаться 0.
// Запуск: iverilog -g2005 -o g.vvp tb_glitch.v top.v && vvp -n g.vvp
`timescale 1ns / 100ps

module tb_glitch;
    reg        clk = 1'b0;
    reg  [1:0] btn = 2'b00;
    wire [5:0] led;
    integer    g;

    always #18.5 clk = ~clk;

    top #(.CLK_HZ(1000)) dut (.clk(clk), .btn_s1(btn[0]), .btn_s2(btn[1]), .led(led));

    initial begin
        #100;
        for (g = 0; g < 10; g = g + 1) begin
            btn[0] = 1'b1;  #300;      // помеха 300 нс
            btn[0] = 1'b0;  #1537;     // пауза; 1837 нс — не кратно периоду, помехи в разных фазах
        end
        $display("помех 10, счёт %0d", ~led);
        $finish;
    end
endmodule
