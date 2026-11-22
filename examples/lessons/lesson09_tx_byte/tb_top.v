// Тестбенч урока 9, практика 1: жмём S1 три раза, тестбенч сам работает
// приёмником UART («как Mac»): ловит старт-бит, читает 8 бит в серединах.
`timescale 1ns / 100ps

module tb_top;
    localparam integer BOUNCE = 3;    // сколько раз контакт дребезжит
    // CLK_HZ = 1000, BAUD = 100: 10 тактов на бит, бит = 10 × 37 = 370 нс.
    localparam integer BIT_NS = 370;

    reg        clk = 1'b0;
    reg        btn = 1'b0;            // S1
    wire       tx;
    wire [5:0] led;

    always #18.5 clk = ~clk;          // период 37 нс, как 27 МГц

    top #(.CLK_HZ(1000), .BAUD(100)) dut (.clk(clk), .btn_s1(btn),
                                         .uart_tx(tx), .led(led));

    // ---------- Приёмник в тестбенче ----------
    reg [7:0] b, shown;
    integer   k, got = 0, errors = 0;

    always begin
        @(negedge tx);                // линия упала: начался старт-бит
        #(BIT_NS / 2);                // середина старт-бита
        if (tx !== 1'b0) errors = errors + 1;
        for (k = 0; k < 8; k = k + 1) begin
            #(BIT_NS);                // середина следующего бита
            b[k] = tx;                // младший бит приходит первым
        end
        #(BIT_NS);                    // середина стоп-бита
        got = got + 1;
        shown = (b >= 8'h20 && b < 8'h7F) ? b : ".";   // непечатные — точкой
        $display("%t  байт %0d: %b = 0x%h = '%c', стоп-бит %b",
                 $realtime, got, b, b, shown, tx);
        if (b !== "H" || tx !== 1'b1) errors = errors + 1;
    end

    // Перевести кнопку в положение v (1 = нажата) с дребезгом и подождать.
    task move (input v);
        integer j;
        begin
            for (j = 0; j < BOUNCE; j = j + 1) begin
                btn = v;   #60;
                btn = ~v;  #40;
            end
            btn = v;  #1500;
        end
    endtask

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $timeformat(-9, 0, " нс", 8);
        #100;
        if (tx !== 1'b1) errors = errors + 1;     // в покое линия = 1
        repeat (3) begin
            move(1'b1);  move(1'b0);              // нажать и отпустить S1
            #3000;                                // кадр = 10 бит = 3700 нс
        end
        $display("отправлено (LED) %0d, принято %0d", ~led, got);
        if (got != 3 || ~led != 6'd3) errors = errors + 1;
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
