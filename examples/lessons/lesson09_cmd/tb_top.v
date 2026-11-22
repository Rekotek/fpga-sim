// Тестбенч урока 9, практика 4: команды. «Mac» набирает 1 3 6 x 3 0 5,
// после каждого символа проверяем светодиоды и эхо.
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

    // Приёмник эха: последний принятый байт.
    reg [7:0] b, last = 8'h00;
    integer   k, errors = 0;

    always begin
        @(negedge tx);
        #(BIT_NS / 2);
        for (k = 0; k < 8; k = k + 1) begin
            #(BIT_NS);
            b[k] = tx;
        end
        #(BIT_NS);
        last = b;
    end

    // Набрать символ c, дождаться эха и проверить светодиоды (want: 1 = горит).
    task key (input [7:0] c, input [5:0] want);
        begin
            send_byte(c);
            #4000;                            // эхо: ещё 10 бит = 3700 нс
            $display("   %c      %c     %b   %b", c, last, ~led, want);
            if (last !== c || ~led !== want) errors = errors + 1;
        end
    endtask

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        #1013;
        $display("клавиша  эхо   LED5..0  ожидали");
        key("1", 6'b000001);
        key("3", 6'b000101);
        key("6", 6'b100101);
        key("x", 6'b100101);    // не команда — ничего не меняется
        key("3", 6'b100001);    // повторное нажатие гасит
        key("0", 6'b000000);
        key("5", 6'b010000);
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
