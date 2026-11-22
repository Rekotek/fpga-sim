// Тестбенч урока 9, практика 3: эхо. Тестбенч играет роль Mac: посылает
// байты на uart_rx (task send_byte) и принимает ответ с uart_tx.
`timescale 1ns / 100ps

module tb_top;
    localparam integer BIT_NS = 370;  // CLK_HZ = 1000, BAUD = 100: бит = 10 тактов

    reg        clk = 1'b0;
    reg        rx  = 1'b1;            // линия от «Mac»: в покое 1
    wire       tx;
    wire [5:0] led;

    always #18.5 clk = ~clk;

    top #(.CLK_HZ(1000), .BAUD(100)) dut (.clk(clk), .uart_rx(rx),
                                         .uart_tx(tx), .led(led));

    // ---------- «Mac» передаёт: один кадр 8N1 на линию rx ----------
    task send_byte (input [7:0] c);
        integer j;
        begin
            rx = 1'b0;  #(BIT_NS);            // старт-бит
            for (j = 0; j < 8; j = j + 1) begin
                rx = c[j];  #(BIT_NS);        // данные, младший бит первым
            end
            rx = 1'b1;  #(BIT_NS);            // стоп-бит
        end
    endtask

    // ---------- «Mac» принимает: всё, что пришло по tx ----------
    reg [7:0] b, shown;
    reg [7:0] echo [0:15];
    integer   k, got = 0, errors = 0;

    always begin
        @(negedge tx);
        #(BIT_NS / 2);
        for (k = 0; k < 8; k = k + 1) begin
            #(BIT_NS);
            b[k] = tx;
        end
        #(BIT_NS);
        if (tx !== 1'b1) errors = errors + 1;
        echo[got] = b;
        got = got + 1;
    end

    reg [8*5-1:0] msg = "FPGA!";
    integer n;

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        #1013;                                // не кратно такту: чужой генератор
        for (n = 0; n < 5; n = n + 1) begin
            send_byte(msg[8*(4 - n) +: 8]);
            #(2 * BIT_NS);                    // пауза, как между нажатиями клавиш
        end
        #5000;
        $display("отправили  получили");
        for (n = 0; n < 5; n = n + 1) begin
            if (n >= got)                                shown = "-";  // не пришло
            else if (echo[n] >= 8'h20 && echo[n] < 8'h7F) shown = echo[n];
            else                                         shown = ".";  // непечатный
            $display("    %c         %c", msg[8*(4 - n) +: 8], shown);
            if (echo[n] !== msg[8*(4 - n) +: 8]) errors = errors + 1;
        end
        $display("всего пришло байт: %0d", got);
        $display("LED сейчас: %b (у '!' = 0x21 = 00100001)", ~led);
        if (got != 5 || ~led != 6'b100001) errors = errors + 1;
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
