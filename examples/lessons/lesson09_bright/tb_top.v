// Тестбенч задания «Яркость с Mac»: «Mac» набирает цифры, после каждой
// проверяем уровень на LED1..LED4 и считаем, сколько тактов из 256 горит LED0.
`timescale 1ns / 100ps

module tb_top;
    localparam integer BIT_NS = 370;  // CLK_HZ = 1000, BAUD = 100: бит = 10 тактов

    reg        clk = 1'b0;
    reg        rx  = 1'b1;
    wire       tx;
    wire [5:0] led;

    always #18.5 clk = ~clk;

    top #(.CLK_HZ(1000), .BAUD(100)) dut (.clk(clk), .uart_rx(rx),
                                         .uart_tx(tx), .led(led));

    task send_byte (input [7:0] c);
        integer j;
        begin
            rx = 1'b0;  #(BIT_NS);
            for (j = 0; j < 8; j = j + 1) begin
                rx = c[j];  #(BIT_NS);
            end
            rx = 1'b1;  #(BIT_NS);
        end
    endtask

    wire [3:0] level = ~led[4:1];
    integer    errors = 0;

    // Набрать символ c и проверить уровень и яркость.
    task key (input [7:0] c, input [3:0] want);
        integer t, ones;
        begin
            send_byte(c);
            ones = 0;
            for (t = 0; t < 256; t = t + 1) begin
                @(negedge clk);
                if (led[0] == 1'b0) ones = ones + 1;
            end
            $display("   %c      %d      %d       %3d      %3d", c, level, want, ones, want * 28);
            if (level !== want || ones != want * 28) errors = errors + 1;
        end
    endtask

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        #1013;
        $display("клавиша уровень ожидали горел из 256 ожидали");
        key("5", 4'd5);
        key("9", 4'd9);
        key("x", 4'd9);         // не цифра — уровень прежний
        key("0", 4'd0);
        key("3", 4'd3);
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
